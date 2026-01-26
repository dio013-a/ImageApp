-- ImageApp Database Schema
-- Run this in your Supabase SQL editor to create the required tables

-- Jobs table: track processing tasks
CREATE TABLE IF NOT EXISTS jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, done, failed
  user_id TEXT,                            -- Telegram user ID (optional)
  chat_id BIGINT,                          -- Telegram chat ID
  message_id BIGINT,                       -- Telegram message ID
  input_url TEXT,                          -- Path to uploaded image in storage
  output_url TEXT,                         -- Path to processed image in storage
  error_message TEXT,                      -- Error details if status=failed
  provider_job_id TEXT,                    -- External provider job ID (e.g. Replicate)
  metadata JSONB,                          -- Additional metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Images table: metadata for stored images
CREATE TABLE IF NOT EXISTS images (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  bucket TEXT NOT NULL,
  path TEXT NOT NULL,
  size BIGINT NOT NULL,                    -- Size in bytes
  content_type TEXT,                       -- MIME type
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_chat_id ON jobs(chat_id);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_images_job_id ON images(job_id);

-- Create updated_at trigger for jobs table
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) Policies
-- Note: For MVP, service_role key bypasses RLS. Add policies as needed.

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE images ENABLE ROW LEVEL SECURITY;

-- Example: Allow service role full access (default)
-- Add more restrictive policies based on your auth requirements
CREATE POLICY "Service role has full access to jobs"
  ON jobs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role has full access to images"
  ON images
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
