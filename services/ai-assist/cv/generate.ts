// Stage A executor: one structured LLM call that returns a CVDraft.
// Uses the AI-Assist provider abstraction (defaults to OpenAI gpt-5.4-mini per
// config) so model/provider choice stays centralized. No tool loop — this is a
// single deterministic-shaped generation, parsed and normalized defensively.

import llm from '../llm';

const { getLlmProvider, getConfiguredModel, getModelLabel } = llm;
import logger from '../../logger';
import { CVAggregateInput } from './aggregator';
import { cvDraftSystemPrompt, cvDraftUserPrompt } from './prompt';
import { parseCVDraftJson, normalizeCVDraft } from './normalize';
import { CVDraft, emptyCVDraft } from './types';

export interface GenerateCVDraftResult {
  draft: CVDraft;
  model: string;
  parseError?: string;
}

export const generateCVDraft = async (
  input: CVAggregateInput,
  fileType: string,
  degree?: string
): Promise<GenerateCVDraftResult> => {
  // CV drafting is text-only and benefits from a capable writer; force the
  // OpenAI provider here regardless of the global AI-Assist default.
  const provider = getLlmProvider('openai');
  const model = getConfiguredModel();

  const result = await provider.stream({
    system: cvDraftSystemPrompt(fileType, degree),
    turns: [{ role: 'user', content: cvDraftUserPrompt(input) }],
    model
  });

  const modelLabel = getModelLabel(provider, result.model || model);

  try {
    const parsed = parseCVDraftJson(result.text);
    return { draft: normalizeCVDraft(parsed), model: modelLabel };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`CV draft JSON parse failed: ${message}`);
    return {
      draft: emptyCVDraft(),
      model: modelLabel,
      parseError: message
    };
  }
};
