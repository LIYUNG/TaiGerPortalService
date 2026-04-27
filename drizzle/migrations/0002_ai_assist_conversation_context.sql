ALTER TABLE ai_assist_conversations
  ADD COLUMN IF NOT EXISTS student_id text;

ALTER TABLE ai_assist_conversations
  ADD COLUMN IF NOT EXISTS student_display_name text;

CREATE INDEX IF NOT EXISTS ai_assist_conversations_owner_status_idx
  ON ai_assist_conversations(owner_user_id, status, updated_at);
