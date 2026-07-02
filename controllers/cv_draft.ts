import { Request, Response } from 'express';

import { asyncHandler } from '../middlewares/error-handler';
import { ErrorResponse } from '../common/errors';
import StudentService from '../services/students';
import DocumentThreadService from '../services/documentthreads';
import PermissionService from '../services/permissions';
import cvDraftService from '../services/ai-assist/cv';
import { renderCVDraftDocx } from '../services/ai-assist/cv/render';
import { CVDraft } from '../services/ai-assist/cv/types';
import { getS3Object, putS3Object } from '../aws/s3';
import { AWS_S3_BUCKET_NAME } from '../config';

const { createCVDraft } = cvDraftService;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

// POST /api/ai-assist/students/:studentId/cv-draft
// Body: { fileType?, programId?, programFullName?, editorRequirements?, documentsthreadId? }
// Returns the structured CVDraft plus a reviewer checklist. Reads reusable facts
// from the student profile and per-document context from the thread's
// additional_information. Stage B (docx render) is not wired yet.
const generateCvDraft = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user as Loose;
  const studentId = String(req.params.studentId);
  const {
    fileType = 'CV',
    programId,
    programFullName,
    editorRequirements,
    documentsthreadId
  } = req.body || {};

  const student = await StudentService.getStudentByIdLean(studentId);
  if (!student) {
    throw new ErrorResponse(404, 'Student not found');
  }

  // Per-document free-text context (student + editor editable) lives on the thread.
  let additionalInformation = '';
  if (documentsthreadId) {
    const thread = (await DocumentThreadService.getThreadByIdLean(
      documentsthreadId
    )) as Loose | null;
    additionalInformation = thread?.additional_information || '';
  }

  const result = await createCVDraft({
    student,
    additionalInformation,
    fileType,
    studentId,
    programId,
    targetProgram: programFullName,
    editorRequirements
  });

  // Persist the generated draft on the thread so a page refresh restores it.
  if (documentsthreadId) {
    await DocumentThreadService.updateThreadById(documentsthreadId, {
      cv_draft: result
    });
  }

  if (user?._id) {
    await PermissionService.decrementTaigerAiQuota(user._id);
  }

  return res.status(200).send({ success: true, data: result });
});

// PUT /api/document-threads/:messagesThreadId/additional-information
// Body: { additionalInformation }
// Persists the thread-scoped free-text context. Editable by the owning student
// and the assigned editors (route-level permissions enforce this). Does NOT
// generate — students may edit here but cannot run the AI draft.
const updateAdditionalInformation = asyncHandler(
  async (req: Request, res: Response) => {
    const messagesThreadId = String(req.params.messagesThreadId);
    const { additionalInformation = '' } = req.body || {};

    const updated = await DocumentThreadService.updateThreadById(
      messagesThreadId,
      { additional_information: String(additionalInformation) }
    );
    if (!updated) {
      throw new ErrorResponse(404, 'Thread not found');
    }

    return res.status(200).send({
      success: true,
      data: { additionalInformation: String(additionalInformation) }
    });
  }
);


// POST /api/ai-assist/students/:studentId/cv-draft/render
// Body: { draft: CVDraft, documentsthreadId }
// Stage B: render the EDITOR-REVIEWED CVDraft into a docx (deterministic, no
// LLM re-generation), embed the passport photo if present, upload to S3 and
// attach it to the thread as an AI first-draft file.
const renderCvDraft = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user as Loose;
  const studentId = String(req.params.studentId);
  const { draft, documentsthreadId } = (req.body || {}) as {
    draft?: CVDraft;
    documentsthreadId?: string;
  };
  if (!draft) {
    throw new ErrorResponse(400, 'Missing draft');
  }
  if (!documentsthreadId) {
    throw new ErrorResponse(400, 'Missing documentsthreadId');
  }

  const student = (await StudentService.getStudentByIdLean(
    studentId
  )) as Loose | null;
  if (!student) {
    throw new ErrorResponse(404, 'Student not found');
  }

  // Passport photo (optional) from the student profile documents.
  let photo: Buffer | undefined;
  const photoPath = (student.profile || []).find(
    (p: Loose) => p?.name === 'Passport_Photo'
  )?.path;
  if (photoPath) {
    try {
      const bytes = await getS3Object(AWS_S3_BUCKET_NAME, photoPath);
      if (bytes) {
        photo = Buffer.from(bytes);
      }
    } catch {
      // Photo is best-effort — render without it on failure.
    }
  }

  const buffer = renderCVDraftDocx(draft, photo);

  const studentName = [student.firstname, student.lastname]
    .filter(Boolean)
    .join('_')
    .replace(/[^\w-]/g, '');
  const fileName = `${studentName || 'CV'}_AI_first_draft_${Date.now()}.docx`;
  const key = `${studentId}/${documentsthreadId}/${fileName}`;

  await putS3Object({
    bucketName: AWS_S3_BUCKET_NAME,
    key,
    Body: buffer,
    ContentType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });

  const thread = (await DocumentThreadService.getThreadDocById(
    documentsthreadId
  )) as Loose | null;
  if (!thread) {
    throw new ErrorResponse(404, 'Thread not found');
  }
  const noteBlocks = JSON.stringify({
    blocks: [
      {
        type: 'paragraph',
        data: { text: 'AI-generated first CV draft. Please review and refine.' }
      }
    ]
  });
  thread.messages.push({
    user_id: user?._id,
    message: noteBlocks,
    createdAt: new Date(),
    file: [{ name: fileName, path: key }]
  });
  thread.updatedAt = new Date();
  await thread.save();

  if (user?._id) {
    await PermissionService.decrementTaigerAiQuota(user._id);
  }

  return res
    .status(200)
    .send({ success: true, data: { name: fileName, path: key } });
});


// GET /api/ai-assist/threads/:documentsthreadId/cv-draft
// Returns the persisted CVDraftResult for the thread (or null), so the AI Draft
// tab can restore the last generated draft after a refresh.
const getSavedCvDraft = asyncHandler(async (req: Request, res: Response) => {
  const documentsthreadId = String(req.params.documentsthreadId);
  const thread = (await DocumentThreadService.getThreadByIdLean(
    documentsthreadId
  )) as Loose | null;
  if (!thread) {
    throw new ErrorResponse(404, 'Thread not found');
  }
  return res
    .status(200)
    .send({ success: true, data: thread.cv_draft ?? null });
});

// POST /api/ai-assist/students/:studentId/cv-draft/render/download
// Body: { draft: CVDraft }
// Renders the reviewed draft and streams the docx straight back as a download
// (no S3 needed) — useful for local dev or a quick copy.
const downloadCvDraft = asyncHandler(async (req: Request, res: Response) => {
  const studentId = String(req.params.studentId);
  const { draft } = (req.body || {}) as { draft?: CVDraft };
  if (!draft) {
    throw new ErrorResponse(400, 'Missing draft');
  }
  const student = (await StudentService.getStudentByIdLean(
    studentId
  )) as Loose | null;

  let photo: Buffer | undefined;
  const photoPath = (student?.profile || []).find(
    (p: Loose) => p?.name === 'Passport_Photo'
  )?.path;
  if (photoPath) {
    try {
      const bytes = await getS3Object(AWS_S3_BUCKET_NAME, photoPath);
      if (bytes) {
        photo = Buffer.from(bytes);
      }
    } catch {
      // best-effort
    }
  }

  const buffer = renderCVDraftDocx(draft, photo);
  const studentName = [student?.firstname, student?.lastname]
    .filter(Boolean)
    .join('_')
    .replace(/[^\w-]/g, '');
  const fileName = `${studentName || 'CV'}_AI_first_draft.docx`;

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  return res.send(buffer);
});

export = {
  generateCvDraft,
  updateAdditionalInformation,
  renderCvDraft,
  getSavedCvDraft,
  downloadCvDraft
};
