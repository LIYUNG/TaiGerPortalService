import Anthropic from '@anthropic-ai/sdk';

import { ANTHROPIC_API_KEY } from '../../../config';
import type {
  LlmProvider,
  StreamParams,
  StreamResult,
  Turn,
  LlmTool
} from './types';

// Anthropic implementation of the LlmProvider strategy.
// One call to `stream` == one model turn. The orchestrator owns the multi-round
// tool loop. See ./types.ts for the neutral shapes (Turn, LlmTool, LlmToolCall).

const DEFAULT_MODEL = 'claude-opus-4-8';
const MAX_OUTPUT_TOKENS = 16000;

let cachedClient: Anthropic | undefined;
const getClient = () => {
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  }
  return cachedClient;
};

const toAnthropicMessages = (turns: Turn[] = []) =>
  turns
    .map((turn) => {
      if (turn.role === 'user') {
        return {
          role: 'user',
          content: [{ type: 'text', text: String(turn.content ?? '') }]
        };
      }

      if (turn.role === 'assistant') {
        const content: Record<string, unknown>[] = [];
        if (turn.text) {
          content.push({ type: 'text', text: turn.text });
        }
        (turn.toolCalls || []).forEach((toolCall) => {
          content.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.input || {}
          });
        });
        // Anthropic rejects empty assistant content; fall back to a space.
        if (!content.length) {
          content.push({ type: 'text', text: ' ' });
        }
        return { role: 'assistant', content };
      }

      if (turn.role === 'tool') {
        return {
          role: 'user',
          content: (turn.results || []).map((result) => ({
            type: 'tool_result',
            tool_use_id: result.id,
            content: String(result.output ?? ''),
            is_error: Boolean(result.isError)
          }))
        };
      }

      return null;
    })
    .filter(Boolean);

const toAnthropicTools = (tools: LlmTool[] = []) =>
  tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters
  }));

const safeEmitToken = async (
  onToken: ((token: string) => Promise<void> | void) | undefined,
  token: string
) => {
  if (typeof onToken !== 'function' || !token) {
    return;
  }
  try {
    await onToken(token);
  } catch {
    // Token streaming is best-effort.
  }
};

const stream: LlmProvider['stream'] = async (
  { system, turns, tools, model }: StreamParams = {} as StreamParams,
  { onToken } = {}
): Promise<StreamResult> => {
  const resolvedModel = model || DEFAULT_MODEL;
  const client = getClient();

  const requestPayload = {
    model: resolvedModel,
    max_tokens: MAX_OUTPUT_TOKENS,
    system,
    messages: toAnthropicMessages(turns),
    ...(tools && tools.length ? { tools: toAnthropicTools(tools) } : {})
  };

  const messageStream = client.messages.stream(
    requestPayload as Anthropic.MessageStreamParams
  );

  for await (const event of messageStream) {
    if (
      event?.type === 'content_block_delta' &&
      event.delta?.type === 'text_delta' &&
      event.delta.text
    ) {
      await safeEmitToken(onToken, event.delta.text);
    }
  }

  const message = await messageStream.finalMessage();
  const blocks = message?.content || [];

  const text = blocks
    .filter(
      (block): block is Anthropic.Messages.TextBlock => block.type === 'text'
    )
    .map((block) => block.text)
    .join('');

  const toolCalls = blocks
    .filter(
      (block): block is Anthropic.Messages.ToolUseBlock =>
        block.type === 'tool_use'
    )
    .map((block) => ({
      id: block.id,
      name: block.name,
      input: (block.input || {}) as Record<string, unknown>
    }));

  return {
    text,
    toolCalls,
    usage: message?.usage,
    model: resolvedModel,
    stopReason: message?.stop_reason
  };
};

const anthropicProvider: LlmProvider = {
  name: 'anthropic',
  defaultModel: DEFAULT_MODEL,
  stream
};

export = anthropicProvider;
