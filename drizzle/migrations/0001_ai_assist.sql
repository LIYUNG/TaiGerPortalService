CREATE TABLE IF NOT EXISTS ai_assist_conversations (
  id text PRIMARY KEY NOT NULL,
  owner_user_id text NOT NULL,
  owner_role text NOT NULL,
  title text NOT NULL DEFAULT 'New AI Assist conversation',
  status text NOT NULL DEFAULT 'active',
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_assist_messages (
  id text PRIMARY KEY NOT NULL,
  conversation_id text NOT NULL REFERENCES ai_assist_conversations(id) ON DELETE cascade,
  role text NOT NULL,
  content text NOT NULL,
  model text,
  response_id text,
  usage jsonb,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_assist_tool_calls (
  id text PRIMARY KEY NOT NULL,
  conversation_id text NOT NULL REFERENCES ai_assist_conversations(id) ON DELETE cascade,
  assistant_message_id text REFERENCES ai_assist_messages(id) ON DELETE cascade,
  tool_name text NOT NULL,
  arguments jsonb,
  result jsonb,
  status text NOT NULL,
  duration_ms integer,
  permission_outcome jsonb,
  error_code text,
  error_message text,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_assist_usage (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL,
  model text NOT NULL,
  date date NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  tool_call_count integer NOT NULL DEFAULT 0,
  estimated_cost numeric(12, 6),
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_assist_conversations_owner_idx
  ON ai_assist_conversations(owner_user_id, updated_at);

CREATE INDEX IF NOT EXISTS ai_assist_messages_conversation_idx
  ON ai_assist_messages(conversation_id, created_at);

CREATE INDEX IF NOT EXISTS ai_assist_tool_calls_message_idx
  ON ai_assist_tool_calls(assistant_message_id, created_at);
