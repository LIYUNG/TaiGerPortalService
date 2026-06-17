import { AI_ASSIST_PROVIDER, AI_ASSIST_MODEL } from '../../../config';
import anthropicProvider from './anthropicProvider';
import openaiProvider from './openaiProvider';
import type { LlmProvider } from './types';

// Registry of all LlmProvider strategy implementations.
const PROVIDERS: Record<string, LlmProvider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider
};

const getLlmProvider = (override = ''): LlmProvider => {
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
