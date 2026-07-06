import { Request, Response } from 'express';
import crypto from 'crypto';

import { asyncHandler } from '../middlewares/error-handler';
import { ErrorResponse } from '../common/errors';
import StudentService from '../services/students';
import DocumentThreadService from '../services/documentthreads';
import PermissionService from '../services/permissions';
import cvDraftService from '../services/ai-assist/cv';
import {
  buildCVReadiness,
  extractKnownFacts
} from '../services/ai-assist/cv/aggregator';
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
const HISTORY_LIMIT = 10;
const pushDraftHistory = (existing: Loose | null | undefined): Loose[] => {
  const prev = (existing?.history as Loose[]) || [];
  if (!existing?.draft) {
    return prev;
  }
  // Dedupe: never record a snapshot identical to the newest one. This stops an
  // A<->B restore loop from evicting genuinely older versions from the cap.
  if (prev[0]?.draft && draftHash(prev[0].draft) === draftHash(existing.draft)) {
    return prev;
  }
  const snapshot = {
    draft: existing.draft,
    // meta carries how that version was made (source: generate/edit/restore).
    meta: existing.meta,
    savedAt: new Date().toISOString()
  };
  return [snapshot, ...prev].slice(0, HISTORY_LIMIT);
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
  // Provenance (which editor notes fed this draft) + an input fingerprint so a
  // later profile/photo/context change can be flagged as stale (W3/W6).
  const inputsHash = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        knownFacts: extractKnownFacts(student as Loose),
        additionalInformation: String(additionalInformation || ''),
        degree: String(degree || ''),
        hasPhoto
      })
    )
    .digest('hex');
  const payload = {
    ...result,
    hasPhoto,
    meta: {
      ...result.meta,
      editorNotes: String(editorRequirements || ''),
      inputsHash,
      source: 'generate'
    }
  };

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
  const fileName = studentName ? `${studentName}_CV.docx` : 'CV.docx';
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

  // Use the template version the renderer ACTUALLY loaded (not the one fetched
  // for the dedup pre-check) — avoids a race where the template changed in between.
  const {
    buffer,
    photoEmbedded,
    templateVersion: renderedTemplateVersion
  } = await renderCVDraftDocx(draft, photo);

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
        templateVersion: renderedTemplateVersion,
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

    if (thread.isFinalVersion) {
      throw new ErrorResponse(
        409,
        'This thread is marked as final. Reopen it before attaching a new CV draft.',
        'CV_DRAFT_THREAD_FINAL'
      );
    }
    if (!String(message || '').trim()) {
      throw new ErrorResponse(400, 'A message is required to attach the draft.');
    }

    // Self-heal: ensure a CURRENT working .docx exists — render it now if there
    // is none or it's stale (draft/template changed). This removes the manual
    // "Create .docx" step and the CV_DRAFT_STALE / CV_DRAFT_NO_RENDER error class;
    // the editor just attaches and the file is produced on demand.
    const hash = draftHash(draft);
    const templateVersion = await getCvTemplateVersion();
    let rendered = thread.cv_draft?.rendered as Loose | undefined;
    const renderCurrent = Boolean(
      rendered?.key &&
        rendered.hash === hash &&
        (rendered.templateVersion ?? '') === templateVersion
    );
    if (!renderCurrent) {
      const sid = String(thread.student_id?._id ?? thread.student_id ?? '');
      const student = sid
        ? ((await StudentService.getStudentByIdLean(sid)) as Loose | null)
        : null;
      let photo: Buffer | undefined;
      const photoPath = (student?.profile || []).find(
        (pf: Loose) => pf?.name === 'Passport_Photo'
      )?.path;
      if (photoPath) {
        try {
          const bytes = await getS3Object(AWS_S3_BUCKET_NAME, photoPath);
          if (bytes) {
            photo = Buffer.from(bytes);
          }
        } catch {
          // photo is best-effort
        }
      }
      const {
        buffer,
        photoEmbedded,
        templateVersion: renderedTemplateVersion
      } = await renderCVDraftDocx(draft, photo);
      const workingKey = cvDraftKey(sid, documentsthreadId);
      await putS3Object({
        bucketName: AWS_S3_BUCKET_NAME,
        key: workingKey,
        Body: buffer,
        ContentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });
      const studentName = [student?.firstname, student?.lastname]
        .filter(Boolean)
        .join('_')
        .replace(/[^\w-]/g, '');
      rendered = {
        hash,
        key: workingKey,
        name: studentName ? `${studentName}_CV.docx` : 'CV.docx',
        at: new Date(),
        templateVersion: renderedTemplateVersion,
        photoEmbedded
      };
      thread.cv_draft = { ...(thread.cv_draft || {}), rendered };
      if (typeof thread.markModified === 'function') {
        thread.markModified('cv_draft');
      }
    }
    const finalRendered = rendered as Loose;

    // Snapshot-copy the working docx to a message-scoped key. The stable working
    // key is overwritten on the next render, so pointing a historical message at
    // it would silently rewrite the thread's audit trail. Copying keeps the
    // attached file immutable.
    let attachKey = String(finalRendered.key);
    try {
      const bytes = await getS3Object(
        AWS_S3_BUCKET_NAME,
        String(finalRendered.key)
      );
      if (!bytes) {
        throw new Error('empty draft file');
      }
      const snapshotKey = String(finalRendered.key).replace(
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

    // Student-visible file name: version-distinct (readable timestamp) and free of
    // any "AI" wording. Sanitise the working-copy base so legacy "_AI_..." names
    // don't leak through.
    const pad = (n: number) => String(n).padStart(2, '0');
    const d = new Date();
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(
      d.getDate()
    )}_${pad(d.getHours())}${pad(d.getMinutes())}`;
    const cleanBase =
      String(finalRendered.name || 'CV')
        .replace(/\.docx$/i, '')
        .replace(/_?AI[_-]?CV[_-]?draft/gi, '')
        .replace(/_?AI[_-]?first[_-]?draft/gi, '')
        .replace(/_?CV$/i, '')
        .replace(/_+$/g, '') || 'CV';
    const attachName = `${cleanBase}_CV_${stamp}.docx`;

    const noteBlocks = JSON.stringify({
      blocks: [{ type: 'paragraph', data: { text: String(message || '') } }]
    });
    thread.messages.push({
      user_id: user?._id,
      message: noteBlocks,
      createdAt: new Date(),
      file: [{ name: attachName, path: attachKey }]
    });
    thread.updatedAt = new Date();
    await thread.save();

    return res.status(200).send({
      success: true,
      data: {
        name: attachName,
        path: attachKey,
        photoEmbedded: finalRendered.photoEmbedded
      }
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

    // Have the generation inputs changed since this draft was made? Compare the
    // stored fingerprint (thread additional_information + whether a photo existed)
    // to the current state, so the UI can prompt a regenerate (W3).
    const currentHasPhoto = hasPassportPhoto(student);
    const savedMeta = (saved.meta as Loose) || {};
    // Fingerprint ALL generation inputs the server can see (profile knownFacts,
    // thread additional_information, degree, photo) so any of them changing since
    // generation flags the draft as stale. Editor notes are compared client-side.
    const currentInputsHash = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          knownFacts: extractKnownFacts((student || {}) as Loose),
          additionalInformation: String(thread.additional_information || ''),
          degree: String(savedMeta.degree || ''),
          hasPhoto: currentHasPhoto
        })
      )
      .digest('hex');
    const inputsChanged = Boolean(
      savedMeta.inputsHash && savedMeta.inputsHash !== currentInputsHash
    );

    // Trim the changelog payload: the client only needs each entry's draft,
    // its source label and when it was saved — drop the rest of meta (model,
    // timestamps, inputsHash, etc.) to keep every tab open / refresh cheap.
    const trimmedHistory = Array.isArray(saved.history)
      ? (saved.history as Loose[]).map((h) => ({
          draft: h.draft,
          meta: { source: (h.meta as Loose)?.source },
          savedAt: h.savedAt
        }))
      : undefined;

    return res.status(200).send({
      success: true,
      data: {
        ...saved,
        ...(trimmedHistory ? { history: trimmedHistory } : {}),
        hasPhoto: currentHasPhoto,
        inputsChanged,
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
  const fileName = studentName ? `${studentName}_CV.docx` : 'CV.docx';

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  return res.send(buffer);
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
      editedAt: new Date().toISOString(),
      // Edits are the only thing this endpoint records now; restore was removed
      // (history is a read-only changelog). Legacy 'restore' snapshots may still
      // exist in stored history and are labelled generically by the client.
      source: 'edit'
    },
    // Snapshot the pre-edit draft into the changelog.
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

// GET /api/ai-assist/ai-quota
// The current user's remaining TaiGer AI quota, so the AI Draft tab can show how
// many credits are left and that Generate costs one.
const getMyAiQuota = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user as Loose;
  if (!user?._id) {
    return res
      .status(200)
      .send({ success: true, data: { quota: null, canUse: false } });
  }
  const permission = (await PermissionService.getPermissionByUserId(
    String(user._id)
  )) as Loose | null;
  return res.status(200).send({
    success: true,
    data: {
      quota: permission?.taigerAiQuota ?? null,
      canUse: Boolean(permission?.canUseTaiGerAI)
    }
  });
});

export = {
  generateCvDraft,
  updateAdditionalInformation,
  validateCvDraft,
  updateCvDraft,
  getCvReadiness,
  getMyAiQuota,
  renderCvDraft,
  attachCvDraftToThread,
  getSavedCvDraft,
  downloadCvDraft
};
