import { Request, Response } from 'express';

import { asyncHandler } from '../middlewares/error-handler';
import { ErrorResponse } from '../common/errors';
import StudentService from '../services/students';
import PermissionService from '../services/permissions';
import cvDraftService from '../services/ai-assist/cv';

const { createCVDraft } = cvDraftService;

// POST /api/ai-assist/students/:studentId/cv-draft
// Body: { fileType?, programId?, programFullName?, editorRequirements? }
// Returns the structured CVDraft plus a reviewer checklist. Stage B (docx
// render) is deliberately not wired yet — this endpoint stops at JSON + checks.
const generateCvDraft = asyncHandler(async (req: Request, res: Response) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = req.user as any;
  const { studentId } = req.params;
  const {
    fileType = 'CV',
    programId,
    programFullName,
    editorRequirements
  } = req.body || {};

  const student = await StudentService.getStudentByIdLean(studentId);
  if (!student) {
    throw new ErrorResponse(404, 'Student not found');
  }

  const result = await createCVDraft({
    student,
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

export = {
  generateCvDraft
};
