// CV draft skill — the public entry point of the AI-Assist CV pipeline.
//   aggregate (profile + survey)  ->  Stage A (LLM -> CVDraft JSON)  ->  validate
// Returns the structured draft plus a reviewer checklist. (Stage B docx render
// is intentionally NOT wired here yet.)

import { buildCVAggregate } from './aggregator';
import { generateCVDraft } from './generate';
import { validateCVDraft } from './validate';
import { CVDraftResult, CreateCVDraftParams } from './types';

const createCVDraft = async (
  params: CreateCVDraftParams
): Promise<CVDraftResult> => {
  const fileType = params.fileType || 'CV';

  const aggregate = buildCVAggregate({
    student: params.student,
    additionalInformation: params.additionalInformation,
    editorRequirements: params.editorRequirements,
    targetProgram: params.targetProgram
  });

  const { draft, model, parseError } = await generateCVDraft(aggregate, fileType);
  const validation = validateCVDraft(draft, fileType);

  // Surface a parse failure as a checklist error so the caller sees one shape.
  if (parseError) {
    validation.items.unshift({
      section: 'system',
      level: 'error',
      code: 'generation_parse_error',
      message: `The AI returned an unparseable draft (${parseError}). Try regenerating.`
    });
    validation.errorCount += 1;
    validation.ok = false;
  }

  return {
    draft,
    validation,
    meta: {
      fileType,
      model,
      studentId: params.studentId,
      programId: params.programId,
      generatedAt: new Date().toISOString()
    }
  };
};

export = {
  createCVDraft
};
