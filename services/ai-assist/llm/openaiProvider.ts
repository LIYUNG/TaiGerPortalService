import { openAIClient, OpenAiModel } from '../../openai';
import type {
  LlmProvider,
  StreamParams,
  StreamResult,
  Turn,
  LlmTool
} from './types';

// OpenAI implementation of the LlmProvider strategy, built on the Responses API.
// One call to `stream` == one model turn. The orchestrator owns the multi-round
// tool loop. See ./types.ts for the neutral shapes.

const DEFAULT_MODEL = OpenAiModel.GPT_5_4_mini || 'gpt-5.4-mini';

const toResponsesInput = (turns: Turn[] = []) => {
  const input: Record<string, unknown>[] = [];

  turns.forEach((turn) => {
    if (turn.role === 'user') {
      input.push({ role: 'user', content: String(turn.content ?? '') });
      return;
    }

    if (turn.role === 'assistant') {
      if (turn.text) {
        input.push({ role: 'assistant', content: turn.text });
      }
      (turn.toolCalls || []).forEach((toolCall) => {
        input.push({
          type: 'function_call',
          call_id: toolCall.id,
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.input || {})
        });
      });
      return;
    }

    if (turn.role === 'tool') {
      (turn.results || []).forEach((result) => {
        input.push({
          type: 'function_call_output',
          call_id: result.id,
          output: String(result.output ?? '')
        });
      });
    }
  });

  return input;
};

const toResponsesTools = (tools: LlmTool[] = []) =>
  tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  }));

// The OpenAI Responses SDK return shape is broad and varies by response kind;
// these helpers probe it structurally, so the param is left untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getResponseText = (response: any) => {
  if (response?.output_text) {
    return response.output_text;
  }

  const message = (response?.output || []).find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (item: any) => item.type === 'message'
  );
  return (
    (message?.content || [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((part: any) => part.text || part.content || '')
      .filter(Boolean)
      .join('\n')
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getToolCalls = (response: any) =>
  (response?.output || [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((item: any) => item.type === 'function_call')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((item: any) => {
      let input: Record<string, unknown> = {};
      try {
        input = item.arguments ? JSON.parse(item.arguments) : {};
      } catch {
        input = {};
      }
      return {
        id: item.call_id,
        name: item.name,
        input
      };
    });

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
  const requestPayload = {
    model: resolvedModel,
    instructions: system,
    input: toResponsesInput(turns),
    ...(tools && tools.length ? { tools: toResponsesTools(tools) } : {})
  };

  let response;

  if (typeof openAIClient.responses?.stream === 'function') {
    const responseStream = openAIClient.responses.stream(requestPayload);
    for await (const event of responseStream) {
      if (
        event?.type === 'response.output_text.delta' &&
        typeof event.delta === 'string' &&
        event.delta
      ) {
        await safeEmitToken(onToken, event.delta);
      }
    }
    response = await responseStream.finalResponse();
  } else {
    response = await openAIClient.responses.create(requestPayload);
    await safeEmitToken(onToken, getResponseText(response));
  }

  return {
    text: getResponseText(response),
    toolCalls: getToolCalls(response),
    usage: response?.usage,
    model: resolvedModel,
    stopReason: response?.status
  };
};

const openaiProvider: LlmProvider = {
  name: 'openai',
  defaultModel: DEFAULT_MODEL,
  stream
};

export = openaiProvider;
