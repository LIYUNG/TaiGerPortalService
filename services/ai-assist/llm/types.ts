// Provider-neutral shapes for the AI Assist LLM strategy interface.

export interface LlmTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  output: string;
  isError?: boolean;
}

export type UserTurn = { role: 'user'; content: string };
export type AssistantTurn = { role: 'assistant'; text: string; toolCalls: LlmToolCall[] };
export type ToolTurn = { role: 'tool'; results: ToolResult[] };
export type Turn = UserTurn | AssistantTurn | ToolTurn;

export interface StreamParams {
  system: string;
  turns: Turn[];
  tools?: LlmTool[];
  model?: string;
}

export interface StreamResult {
  text: string;
  toolCalls: LlmToolCall[];
  usage: unknown;
  model: string;
  stopReason: string | null | undefined;
}

export interface LlmProvider {
  name: string;
  defaultModel: string;
  stream(
    params: StreamParams,
    options?: { onToken?: (token: string) => Promise<void> | void }
  ): Promise<StreamResult>;
}
