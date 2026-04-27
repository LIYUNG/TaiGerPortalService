-- AI Assist phase 2 cleanup
-- Remove currently unused schema objects.

ALTER TABLE ai_assist_tool_calls
  DROP COLUMN IF EXISTS error_code;

DROP TABLE IF EXISTS ai_assist_usage;
