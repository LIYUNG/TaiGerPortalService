-- AI Assist schema optimization (safe phase)
-- 1) Add missing indexes for dominant read patterns.
-- 2) Add uniqueness guard for daily usage aggregation.
-- 3) Remove redundant legacy index superseded by owner+status index.

CREATE INDEX IF NOT EXISTS ai_assist_tool_calls_conversation_created_idx
  ON ai_assist_tool_calls(conversation_id, created_at);

CREATE INDEX IF NOT EXISTS ai_assist_conversations_recent_students_idx
  ON ai_assist_conversations(owner_user_id, updated_at DESC)
  WHERE status = 'active' AND student_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ai_assist_usage_user_model_date_unique
  ON ai_assist_usage(user_id, model, date);

DROP INDEX IF EXISTS ai_assist_conversations_owner_idx;
