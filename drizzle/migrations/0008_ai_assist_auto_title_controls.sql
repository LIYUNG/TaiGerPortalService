-- AI Assist auto-title controls
-- Add metadata fields so title generation can be safely automated without
-- overriding user-provided titles.

ALTER TABLE ai_assist_conversations
  ADD COLUMN IF NOT EXISTS title_auto_generated boolean NOT NULL DEFAULT true;

ALTER TABLE ai_assist_conversations
  ADD COLUMN IF NOT EXISTS title_updated_by_user boolean NOT NULL DEFAULT false;

ALTER TABLE ai_assist_conversations
  ADD COLUMN IF NOT EXISTS title_generated_at timestamp;

-- Legacy conversations with a custom title should be protected from future
-- auto-generated title updates.
UPDATE ai_assist_conversations
SET
  title_auto_generated = false,
  title_updated_by_user = true
WHERE title IS NOT NULL
  AND title <> 'New AI Assist conversation';
