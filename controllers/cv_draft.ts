import { Request, Response } from 'express';
import crypto from 'crypto';

import { asyncHandler } from '../middlewares/error-handler';
import { ErrorResponse } from '../common/errors';
import StudentService from '../services/students';
import DocumentThreadService from '../services/documentthreads';
import PermissionService from '../services/permissions';
import cvDraftService from '../services/ai-assist/cv';
import { buildCVReadiness } from '../services/ai-assist/cv/aggregator';
import {
  renderCVDraftDocx,
  getCvTemplateVersion
} from '../services/ai-assist/cv/render';
import { CVDraft } from '../services/ai-assist/cv/types';
import { validateCVDraft } from '../services/ai-assist/cv/validate';
import { getS3Object, putS3Object } from '../aws/s3';
import { AWS_S3_BUCKET_NAME } from '../config';

const { createCVDraft } = cvDraftService;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

// Deterministic fingerprint of a reviewed draft. Used to (a) skip re-rendering
// an unchanged draft and (b) detect a stale rendered file before attaching it.
const draftHash = (draft: CVDraft): string =>
  crypto.createHash('sha256').update(JSON.stringify(draft)).digest('hex');

// Stable, per-thread S3 key for the working CV draft docx. Overwritten on each
// render so we keep exactly one working copy (no timestamped version sprawl).
const cvDraftKey = (studentId: string, documentsthreadId: string): string =>
  `${studentId}/${documentsthreadId}/cv_ai_draft.docx`;

// Keep the last N draft snapshots on the thread so an editor can see what a
// regenerate/edit changed and undo it. JSON only — this does NOT create extra
// stored files and is unrelated to the single stable working-docx key.
const HISTORY_LIMIT = 5;
const pushDraftHistory = (existing: Loose | null | undefined): Loose[] => {
  if (!existing?.draft) {
    return (existing?.history as Loose[]) || [];
  }
  const snapshot = {
    draft: existing.draft,
    meta: existing.meta,
    savedAt: new Date().toISOString()
  };
  return [snapshot, ...((existing.history as Loose[]) || [])].slice(
    0,
    HISTORY_LIMIT
  );
};

// True when the student has an actually-uploaded passport photo: a profile doc
// named Passport_Photo that has a stored file path.
const hasPassportPhoto = (student: Loose | null | undefined): boolean =>
  Boolean(
    ((student?.profile as Loose[]) || []).find(
      (p) => p?.name === 'Passport_Photo' && p?.path
    )
  );

// POST /api/ai-assist/students/:studentId/cv-draft
// Body: { fileType?, programId?, programFullName?, editorRequirements?, documentsthreadId? }
// Returns the structured CVDraft plus a reviewer checklist. Reads reusable facts
// from the student profile and per-document context from the thread's
// additional_information.
const generateCvDraft = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user as Loose;
  const studentId = String(req.params.studentId);
  const {
    fileType = 'CV',
    programId,
    programFullName,
    degree,
    editorRequirements,
    documentsthreadId
  } = req.body || {};

  const student = await StudentService.getStudentByIdLean(studentId);
  if (!student) {
    throw new ErrorResponse(404, 'Student not found');
  }

  // Per-document free-text context (student + editor editable) lives on the thread.
  let additionalInformation = '';
  let existingCvDraft: Loose | null = null;
  if (documentsthreadId) {
    const thread = (await DocumentThreadService.getThreadByIdLean(
      documentsthreadId
    )) as Loose | null;
    additionalInformation = thread?.additional_information || '';
    existingCvDraft = (thread?.cv_draft as Loose) || null;
  }

  const result = await createCVDraft({
    student,
    additionalInformation,
    fileType,
    studentId,
    programId,
    degree,
    targetProgram: programFullName,
    editorRequirements
  });

  // Whether the student has a passport photo on file — surfaced in the AI Draft
  // tab coverage panel and embedded into the .docx at render time.
  const hasPhoto = hasPassportPhoto(student as Loose);
  const payload = { ...result, hasPhoto };

  // A parse failure yields an EMPTY draft. Persisting it would clobber a good
  // saved draft (e.g. an editor regenerating a near-final one), and billing quota
  // for a non-result is unfair. Return it so the UI can show a retry state, but
  // neither persist nor charge.
  const parseFailed = Boolean(result.meta.parseError);
  // Snapshot the outgoing (previous) draft into history before overwriting it.
  const history = parseFailed ? [] : pushDraftHistory(existingCvDraft);
  const payloadWithHistory = { ...payload, history };

  if (documentsthreadId && !parseFailed) {
    // Persist the generated draft on the thread so a page refresh restores it.
    // This also drops any previous `rendered` metadata, so a freshly generated
    // draft is correctly treated as not-yet-rendered.
    await DocumentThreadService.updateThreadById(documentsthreadId, {
      cv_draft: payloadWithHistory
    });
  }

  if (user?._id && !parseFailed) {
    await PermissionService.decrementTaigerAiQuota(user._id);
  }

  return res
    .status(200)
    .send({ success: true, data: payloadWithHistory });
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
// LLM re-generation) and store ONE working copy at a stable S3 key (overwritten).
// Unchanged drafts are not re-rendered.
// The file is NOT attached to the thread here — the editor shares it explicitly
// via attachCvDraftToThread.
const renderCvDraft = asyncHandler(async (req: Request, res: Response) => {
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

  const thread = (await DocumentThreadService.getThreadByIdLean(
    documentsthreadId
  )) as Loose | null;
  if (!thread) {
    throw new ErrorResponse(404, 'Thread not found');
  }

  const studentName = [student.firstname, student.lastname]
    .filter(Boolean)
    .join('_')
    .replace(/[^\w-]/g, '');
  const fileName = `${studentName || 'CV'}_AI_first_draft.docx`;
  const key = cvDraftKey(studentId, documentsthreadId);
  const hash = draftHash(draft);
  // Current template revision — folded into the dedup so an admin template update
  // invalidates a previously-rendered (otherwise-identical) draft.
  const templateVersion = await getCvTemplateVersion();

  // Dedup: the same draft was already rendered to the stable key against the same
  // template — reuse it instead of re-rendering and re-uploading.
  const rendered = thread.cv_draft?.rendered as Loose | undefined;
  if (
    rendered?.hash === hash &&
    rendered?.key &&
    (rendered?.templateVersion ?? '') === templateVersion
  ) {
    return res.status(200).send({
      success: true,
      data: {
        name: rendered.name || fileName,
        path: rendered.key,
        hash,
        reused: true,
        photoEmbedded: rendered.photoEmbedded
      }
    });
  }

  // Passport photo (optional) from the student profile documents — embedded into
  // the CV by the renderer if present and in a supported format.
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

  const { buffer, photoEmbedded } = await renderCVDraftDocx(draft, photo);

  await putS3Object({
    bucketName: AWS_S3_BUCKET_NAME,
    key,
    Body: buffer,
    ContentType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });

  // Record what we rendered so we can dedup future renders and validate the file
  // is current before the editor attaches it.
  await DocumentThreadService.updateThreadById(documentsthreadId, {
    cv_draft: {
      ...(thread.cv_draft || {}),
      rendered: {
        hash,
        key,
        name: fileName,
        at: new Date(),
        templateVersion,
        photoEmbedded
      }
    }
  });

  return res.status(200).send({
    success: true,
    data: { name: fileName, path: key, hash, photoEmbedded }
  });
});

// POST /api/ai-assist/threads/:documentsthreadId/cv-draft/attach
// Body: { draft: CVDraft, message?: string }
// Attaches the already-rendered CV draft docx to the thread as a message the
// student can see. The editor supplies the message text. The rendered file must
// be current (its hash must match the submitted draft) — otherwise we 409 so the
// editor regenerates before sharing a stale document.
const attachCvDraftToThread = asyncHandler(
  async (req: Request, res: Response) => {
    const user = req.user as Loose;
    const documentsthreadId = String(req.params.documentsthreadId);
    const { draft, message } = (req.body || {}) as {
      draft?: CVDraft;
      message?: string;
    };
    if (!draft) {
      throw new ErrorResponse(400, 'Missing draft');
    }

    const thread = (await DocumentThreadService.getThreadDocById(
      documentsthreadId
    )) as Loose | null;
    if (!thread) {
      throw new ErrorResponse(404, 'Thread not found');
    }

    const rendered = thread.cv_draft?.rendered as Loose | undefined;
    if (!rendered?.key) {
      throw new ErrorResponse(
        409,
        'No rendered CV draft to attach. Please generate the .docx first.',
        'CV_DRAFT_NO_RENDER'
      );
    }
    if (rendered.hash !== draftHash(draft)) {
      throw new ErrorResponse(
        409,
        'The CV draft changed since the .docx was generated. Please regenerate before attaching.',
        'CV_DRAFT_STALE'
      );
    }

    // Snapshot-copy the working docx to a message-scoped key. The stable working
    // key is overwritten on the next render, so pointing a historical message at
    // it would silently rewrite the thread's audit trail. Copying keeps the
    // attached file immutable.
    let attachKey = String(rendered.key);
    try {
      const bytes = await getS3Object(AWS_S3_BUCKET_NAME, String(rendered.key));
      if (!bytes) {
        throw new Error('empty draft file');
      }
      const snapshotKey = String(rendered.key).replace(
        /\.docx$/i,
        `_${Date.now()}.docx`
      );
      await putS3Object({
        bucketName: AWS_S3_BUCKET_NAME,
        key: snapshotKey,
        Body: Buffer.from(bytes as Uint8Array),
        ContentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });
      attachKey = snapshotKey;
    } catch {
      throw new ErrorResponse(
        500,
        'Could not snapshot the CV draft file for attaching. Please try again.'
      );
    }

    const noteBlocks = JSON.stringify({
      blocks: [{ type: 'paragraph', data: { text: String(message || '') } }]
    });
    thread.messages.push({
      user_id: user?._id,
      message: noteBlocks,
      createdAt: new Date(),
      file: [{ name: rendered.name, path: attachKey }]
    });
    thread.updatedAt = new Date();
    await thread.save();

    return res.status(200).send({
      success: true,
      data: { name: rendered.name, path: attachKey }
    });
  }
);

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
  const saved = (thread.cv_draft as Loose | null) ?? null;
  if (saved) {
    // Refresh photo status from the current profile so the coverage panel
    // reflects a photo uploaded AFTER the draft was generated (no regenerate).
    const sid = thread.student_id?._id ?? thread.student_id;
    const student = sid
      ? ((await StudentService.getStudentByIdLean(String(sid))) as Loose | null)
      : null;

    // Is the persisted rendered .docx still current for the saved draft? If so,
    // the client can restore the "ready to attach" state after a refresh / tab
    // switch instead of forcing a re-render (this is exactly what attach checks).
    const rendered = saved.rendered as Loose | undefined;
    const renderedCurrent = Boolean(
      rendered?.key && rendered?.hash === draftHash(saved.draft as CVDraft)
    );

    return res.status(200).send({
      success: true,
      data: {
        ...saved,
        hasPhoto: hasPassportPhoto(student),
        renderedCurrent,
        rendered: renderedCurrent
          ? {
              name: rendered?.name,
              path: rendered?.key,
              photoEmbedded: rendered?.photoEmbedded
            }
          : null
      }
    });
  }
  return res.status(200).send({ success: true, data: null });
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

  const { buffer } = await renderCVDraftDocx(draft, photo);
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

// GET /api/ai-assist/students/:studentId/cv-photo
// Streams the student's passport photo (profile doc "Passport_Photo") for the CV
// Details preview, or 404 when none is uploaded.
const getCvPassportPhoto = asyncHandler(async (req: Request, res: Response) => {
  const studentId = String(req.params.studentId);
  const student = (await StudentService.getStudentByIdLean(
    studentId
  )) as Loose | null;
  if (!student) {
    throw new ErrorResponse(404, 'Student not found');
  }
  const photoPath = (student.profile || []).find(
    (p: Loose) => p?.name === 'Passport_Photo' && p?.path
  )?.path;
  if (!photoPath) {
    throw new ErrorResponse(404, 'No passport photo');
  }
  const bytes = await getS3Object(AWS_S3_BUCKET_NAME, photoPath);
  if (!bytes) {
    throw new ErrorResponse(404, 'No passport photo');
  }
  const buffer = Buffer.from(bytes as Uint8Array);
  const b0 = buffer[0];
  const type =
    b0 === 0x89
      ? 'image/png'
      : b0 === 0xff
        ? 'image/jpeg'
        : b0 === 0x47
          ? 'image/gif'
          : b0 === 0x42
            ? 'image/bmp'
            : 'application/octet-stream';
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'private, max-age=30');
  return res.end(buffer);
});

// POST /api/ai-assist/students/:studentId/cv-draft/validate
// Body: { draft: CVDraft, fileType?, degree? }
// Re-runs the deterministic checklist over an EDITOR-EDITED draft (no LLM, no
// persistence). Lets the AI Draft tab keep the checklist honest after inline
// edits — an edited draft must never show green while carrying a bad value.
const validateCvDraft = asyncHandler(async (req: Request, res: Response) => {
  const {
    draft,
    fileType = 'CV',
    degree
  } = (req.body || {}) as { draft?: CVDraft; fileType?: string; degree?: string };
  if (!draft) {
    throw new ErrorResponse(400, 'Missing draft');
  }
  const validation = validateCVDraft(draft, fileType, degree);
  return res.status(200).send({ success: true, data: { validation } });
});

// PUT /api/ai-assist/threads/:documentsthreadId/cv-draft
// Body: { draft: CVDraft, degree? }
// Persists editor inline edits to the reviewed draft. Re-validates deterministically
// and DROPS any previous `rendered` metadata, so the working .docx must be
// re-created from the edited draft before it can be attached (keeps the stale
// guard honest). Preserves meta so provenance/model survive the edit.
const updateCvDraft = asyncHandler(async (req: Request, res: Response) => {
  const documentsthreadId = String(req.params.documentsthreadId);
  const { draft, degree } = (req.body || {}) as {
    draft?: CVDraft;
    degree?: string;
  };
  if (!draft) {
    throw new ErrorResponse(400, 'Missing draft');
  }

  const thread = (await DocumentThreadService.getThreadByIdLean(
    documentsthreadId
  )) as Loose | null;
  if (!thread) {
    throw new ErrorResponse(404, 'Thread not found');
  }

  const existing = (thread.cv_draft as Loose) || {};
  const fileType = (existing.meta?.fileType as string) || 'CV';
  const effectiveDegree = degree ?? (existing.meta?.degree as string | undefined);
  const validation = validateCVDraft(draft, fileType, effectiveDegree);

  // Replace draft + validation; keep meta; drop `rendered` (the edited draft no
  // longer matches any previously rendered file).
  const payload: Loose = {
    ...existing,
    draft,
    validation,
    meta: {
      ...(existing.meta || {}),
      degree: effectiveDegree,
      editedAt: new Date().toISOString()
    },
    // Snapshot the pre-edit draft so the editor can undo the edit.
    history: pushDraftHistory(existing)
  };
  delete payload.rendered;

  await DocumentThreadService.updateThreadById(documentsthreadId, {
    cv_draft: payload
  });

  const sid = thread.student_id?._id ?? thread.student_id;
  const student = sid
    ? ((await StudentService.getStudentByIdLean(String(sid))) as Loose | null)
    : null;

  return res.status(200).send({
    success: true,
    data: { ...payload, hasPhoto: hasPassportPhoto(student), renderedCurrent: false, rendered: null }
  });
});

// GET /api/ai-assist/students/:studentId/cv-draft/readiness
// A pre-generation readiness snapshot computed from the student profile (shared
// aggregator code), so the AI Draft tab can show what's already fillable BEFORE
// spending an AI credit — fewer wasted generations and regenerate loops.
const getCvReadiness = asyncHandler(async (req: Request, res: Response) => {
  const studentId = String(req.params.studentId);
  const student = (await StudentService.getStudentByIdLean(
    studentId
  )) as Loose | null;
  if (!student) {
    throw new ErrorResponse(404, 'Student not found');
  }
  const readiness = [
    { key: 'photo', ok: hasPassportPhoto(student) },
    ...buildCVReadiness(student)
  ];
  return res.status(200).send({ success: true, data: { readiness } });
});

export = {
  generateCvDraft,
  updateAdditionalInformation,
  validateCvDraft,
  updateCvDraft,
  getCvReadiness,
  renderCvDraft,
  attachCvDraftToThread,
  getCvPassportPhoto,
  getSavedCvDraft,
  downloadCvDraft
};
