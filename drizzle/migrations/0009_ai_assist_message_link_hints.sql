-- AI Assist message link hints
-- Store model-selected link targets so frontend does not infer links from raw text.

ALTER TABLE ai_assist_messages
  ADD COLUMN IF NOT EXISTS link_hints jsonb;
