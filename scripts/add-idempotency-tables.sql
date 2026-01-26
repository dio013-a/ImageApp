-- Idempotency tables for Telegram webhook
-- Run this in Supabase SQL Editor

-- Table to track processed Telegram update_ids to prevent duplicate processing
CREATE TABLE IF NOT EXISTS processed_updates (
  id BIGSERIAL PRIMARY KEY,
  update_id BIGINT NOT NULL UNIQUE,
  chat_id TEXT,
  update_type TEXT, -- 'message', 'callback_query', 'edited_message', etc.
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookup by update_id
CREATE INDEX IF NOT EXISTS idx_processed_updates_update_id ON processed_updates(update_id);

-- Index for cleanup queries (delete old records)
CREATE INDEX IF NOT EXISTS idx_processed_updates_processed_at ON processed_updates(processed_at DESC);

-- Optional: Auto-cleanup function to delete old processed_updates (older than 7 days)
-- This prevents the table from growing indefinitely
CREATE OR REPLACE FUNCTION cleanup_old_processed_updates()
RETURNS void AS $$
BEGIN
  DELETE FROM processed_updates
  WHERE processed_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- Optional: Create a scheduled job to run cleanup (requires pg_cron extension)
-- Uncomment if you have pg_cron enabled:
-- SELECT cron.schedule('cleanup-processed-updates', '0 2 * * *', 'SELECT cleanup_old_processed_updates()');
