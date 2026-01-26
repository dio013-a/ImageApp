# telegram-image-core

API-only Next.js backend on Vercel for Telegram bot image processing with external providers (Replicate/Banana) and Supabase storage.

## What is this?

This is a server-side Next.js (TypeScript) backend that handles:
- Telegram webhook processing
- Supabase database + storage operations
- External provider callbacks (e.g., Replicate)
- Automatic image retention and cleanup
- No frontend UI — API routes only
- All secrets server-side only

## Prerequisites

- **Supabase project** with Database + Storage bucket
- **Telegram bot token** (from @BotFather)
- **Image provider key** (Replicate or Banana)
- **Vercel project** connected to GitHub repo

## Environment Variables (Vercel)

Set these in Vercel project settings for **both Preview and Production**:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key-here
TG_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
BASE_URL=https://your-app.vercel.app
REPLICATE_KEY=r8_your_replicate_key_here
STORAGE_BUCKET=uploads
ADMIN_TOKEN=your-random-admin-token
RETENTION_DAYS=30
POLL_INTERVAL_MS=5000
NODE_ENV=production
```

**Important:** `SUPABASE_KEY` is the service_role key (server-only). Never expose to clients.

## Supabase Setup

### 1. Create Database Tables

Run this SQL in Supabase SQL Editor:

```sql
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  telegram_chat_id TEXT NOT NULL,
  telegram_message_id TEXT,
  provider TEXT,
  provider_job_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  input JSONB DEFAULT '{}'::jsonb,
  output JSONB,
  result_url TEXT,
  error TEXT,
  webhook_secret TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  variant_name TEXT NOT NULL DEFAULT 'final',
  mime TEXT,
  filesize INTEGER,
  width INTEGER,
  height INTEGER,
  file_hash TEXT,
  storage_bucket TEXT NOT NULL DEFAULT 'uploads',
  storage_path TEXT NOT NULL,
  public_url TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  retention_expires_at TIMESTAMPTZ,
  is_original BOOLEAN NOT NULL DEFAULT false,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_created ON jobs(created_at DESC);
CREATE INDEX idx_images_job_id ON images(job_id);
CREATE INDEX idx_images_retention ON images(retention_expires_at) WHERE retention_expires_at IS NOT NULL;
```

### 2. Create Storage Bucket

- Go to Supabase Storage
- Create new bucket: `uploads`
- Set to **Private** (not public)

## Telegram Webhook Setup

After deploying to Vercel, register the webhook:

**Option 1: Using script**
```bash
TG_TOKEN=your-token BASE_URL=https://your-app.vercel.app npm run set:webhook
```

**Option 2: Using curl**
```bash
curl -X POST https://api.telegram.org/bot<TG_TOKEN>/setWebhook \
  -H "Content-Type: application/json" \
  -d '{"url":"https://your-app.vercel.app/api/telegram/webhook","drop_pending_updates":true}'
```

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy environment template:
   ```bash
   cp .env.example .env
   ```

3. Fill in `.env` with your credentials

4. Run development server:
   ```bash
   npm run dev
   ```

## Smoke Test Checklist

After deploying:

1. **Health check:**
   ```bash
   curl https://your-app.vercel.app/api/health
   ```
   Should return `{"ok":true,...}`

2. **Telegram bot:**
   - Send `/start` → bot replies with welcome message
   - Send a photo → bot replies "Processing..."
   - Wait ~30 seconds → bot sends final processed image

3. **Admin endpoints:**
   ```bash
   curl https://your-app.vercel.app/api/admin/jobs \
     -H "x-admin-token: your-admin-token"
   ```
   Should return recent jobs array

4. **Admin dashboard:**
   Visit `https://your-app.vercel.app/admin?token=your-admin-token`

## Provider Configuration

### Replicate

Set these env vars:
- `REPLICATE_KEY` - Your Replicate API token
- `REPLICATE_MODEL_VERSION` - Model version ID (optional, can pass in code)

Webhook callback URL is automatically set to:
`https://your-app.vercel.app/api/provider/callback?job_id=<jobId>`

## Logs & Debugging

View logs in Vercel dashboard under Functions → Function Logs

Log prefixes used:
- `[telegram/webhook]` - Telegram webhook processing
- `[provider/callback]` - Provider webhook callbacks
- `[storeResult]` - Image storage operations
- `[worker:gc]` - Garbage collection (if worker deployed)
- `[admin/*]` - Admin endpoint access

## Worker (Optional)

The worker runs garbage collection for expired images. Deploy separately to Sliplane or similar:

```bash
# Build worker
npm run build:worker

# Run worker
npm run worker
```

Or use Docker:
```bash
docker build -f worker/Dockerfile -t telegram-image-worker .
docker run --env-file .env telegram-image-worker
```

## Scripts

- `npm run dev` - Start Next.js dev server
- `npm run build` - Build Next.js for production
- `npm run typecheck` - Type check TypeScript
- `npm run lint` - Lint code
- `npm run set:webhook` - Register Telegram webhook
- `npm run smoke` - Health check smoke test
- `npm run build:worker` - Build worker
- `npm run worker` - Run worker

## Important Notes

- **All secrets are server-side only** — never expose `SUPABASE_KEY` (service_role) or `TG_TOKEN` to clients
- This is an API-only project; no client-side code or Supabase usage
- Images auto-expire after `RETENTION_DAYS` (default 30)
- Provider callbacks are idempotent to prevent duplicate sends
