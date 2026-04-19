ALTER TABLE ai_assist_messages
  ADD COLUMN IF NOT EXISTS skill_trace jsonb;
