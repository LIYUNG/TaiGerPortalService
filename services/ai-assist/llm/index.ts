import { AI_ASSIST_PROVIDER, AI_ASSIST_MODEL } from '../../../config';
import anthropicProvider from './anthropicProvider';
import openaiProvider from './openaiProvider';

/**
 * Provider-neutral LLM layer for AI Assist.
 *
 * The orchestrator builds a provider-neutral conversation and calls
 * `provider.stream(params, { onToken })` once per model turn; the orchestrator
 * itself owns the multi-round tool loop.
 *
 * Neutral shapes:
 *   LlmTool      = { name: string, description: string, parameters: JSONSchema }
 *   LlmToolCall  = { id: string, name: string, input: object }
 *   Turn         =
 *       { role: 'user', content: string }
 *     | { role: 'assistant', text: string, toolCalls: LlmToolCall[] }
 *     | { role: 'tool', results: [{ id, name, output: string, isError?: boolean }] }
 *
 * stream({ system, turns, tools, model? }, { onToken })
 *   -> { text, toolCalls: LlmToolCall[], usage, model, stopReason }
 */

const PROVIDERS = {
  anthropic: anthropicProvider,
  openai: openaiProvider
};

const getLlmProvider = (override = '') => {
  const name = String(override || AI_ASSIST_PROVIDER || 'anthropic').toLowerCase();
  return PROVIDERS[name] || anthropicProvider;
};

// Model id used for persistence/tracing, stored as `provider:model`.
const getModelLabel = (provider, model) =>
  `${provider.name}:${model || provider.defaultModel}`;

const getConfiguredModel = () => AI_ASSIST_MODEL || undefined;

export = {
  getLlmProvider,
  getConfiguredModel,
  getModelLabel
};
