-- Sessions table for multi-photo family portrait workflow
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Telegram context
  telegram_chat_id TEXT NOT NULL,
  telegram_user_id TEXT,
  
  -- Session state
  status TEXT NOT NULL DEFAULT 'collecting', -- collecting | processing | done | failed | cancelled
  
  -- Collected images (array of objects with file_id, storage_path, etc.)
  image_input JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- Generation metadata
  prompt TEXT,
  aspect_ratio TEXT DEFAULT '4:3',
  resolution TEXT DEFAULT '2K',
  output_format TEXT DEFAULT 'png',
  
  -- Link to job (once submitted to Replicate)
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  
  -- Metadata
  image_count INT GENERATED ALWAYS AS (jsonb_array_length(image_input)) STORED,
  error_message TEXT,
  
  CONSTRAINT image_count_limit CHECK (jsonb_array_length(image_input) <= 14)
);

-- Index for quick lookup by chat
CREATE INDEX IF NOT EXISTS idx_sessions_chat_id_status 
  ON sessions(telegram_chat_id, status);

-- Index for updated_at for cleanup
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at 
  ON sessions(updated_at);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_sessions_updated_at();

-- Cleanup old sessions (optional cron job)
-- DELETE FROM sessions WHERE updated_at < now() - interval '7 days' AND status IN ('done', 'failed', 'cancelled');
