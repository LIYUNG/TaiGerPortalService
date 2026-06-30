import { Request, Response } from 'express';

import { asyncHandler } from '../middlewares/error-handler';
import { ErrorResponse } from '../common/errors';
import StudentService from '../services/students';
import DocumentThreadService from '../services/documentthreads';
import PermissionService from '../services/permissions';
import cvDraftService from '../services/ai-assist/cv';

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

export = {
  generateCvDraft,
  updateAdditionalInformation
};
