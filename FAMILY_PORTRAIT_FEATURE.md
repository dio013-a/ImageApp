# Session-Based Family Portrait Feature

## Overview

The bot now supports **multi-photo session-based workflow** for creating professional studio family portraits using Replicate.

## User Flow

### 1. Start Session
```
User: /start
Bot: Welcome! 🎬

Send me 1–14 photos of family members.
• One person per photo is fine
• Best quality: send as File / Document
• When finished, press ✅ Done

I'll create a professional studio family portrait.

[✅ Done] [❌ Cancel]
[ℹ️ Tips]
```

### 2. Collect Images
```
User: [sends photo]
Bot: ✅ Added (1). For best quality, send as File/Document. Press ✅ Done when ready.
[✅ Done] [❌ Cancel]
[ℹ️ Tips]

User: [sends another photo]
Bot: ✅ Got it (2 images). Send more photos or press ✅ Done.
[✅ Done] [❌ Cancel]
[ℹ️ Tips]

User: [sends 3 photos as album/bulk]
Bot: ✅ Got 3 photos from your album! (5 total)

Send more or press ✅ Done when ready.
[✅ Done] [❌ Cancel]
[ℹ️ Tips]
```

### 3. Submit for Processing
```
User: [presses ✅ Done button]
Bot: 🎬 Creating your professional studio family portrait from 2 photos…

This may take a few minutes. I'll send the result here when ready.
```

### 4. Receive Result
```
Bot: [sends final image]
✅ Done. This is your professional studio family portrait from 2 photos.

Want a different style? Send /start to begin again.
```

## Technical Implementation

### Database Schema

New `sessions` table:
```sql
- id (UUID, primary key)
- telegram_chat_id (TEXT)
- status (collecting | processing | done | failed | cancelled)
- image_input (JSONB array)
- prompt (TEXT)
- job_id (UUID, references jobs)
- created_at, updated_at (TIMESTAMPTZ)
```

Run migration:
```sql
-- In Supabase SQL Editor
\i scripts/add-sessions-table.sql
```

### Key Files

#### New Files
- `lib/sessionHelpers.ts` - Session CRUD operations
- `lib/promptBuilder.ts` - Studio portrait prompt generation
- `scripts/add-sessions-table.sql` - Database migration

#### Modified Files
- `pages/api/telegram/webhook.ts` - Complete rewrite for session management + media group support
- `lib/telegram.ts` - Added callback query support
- `lib/provider.ts` - Multi-image support
- `pages/api/provider/callback.ts` - Session status updates

### Features

#### Media Group (Album) Support
When users send multiple photos at once (as an album), Telegram sends them with a `media_group_id`. The bot:
- Detects photos from the same album
- Buffers them with a 2-second delay
- Sends one consolidated message: "✅ Got 3 photos from your album! (5 total)"
- Avoids spamming separate confirmations for each photo

### Replicate Integration

The provider now supports multiple images:

```typescript
// OLD (single image)
await startProviderJob({
  jobId: job.id,
  inputImage: { bucket, path },
});

// NEW (multi-image)
await startProviderJob({
  jobId: job.id,
  inputImages: [
    { bucket, path: 'sessions/.../input_1.jpg' },
    { bucket, path: 'sessions/.../input_2.jpg' },
  ],
  prompt: 'Professional studio family portrait...',
  settings: {
    aspect_ratio: '4:3',
    resolution: '2K',
    output_format: 'png',
    safety_filter_level: 'block_only_high',
  },
});
```

### Request Payload to Replicate

```json
{
  "version": "model-version-id",
  "input": {
    "image_input": [
      "https://supabase.co/signed-url-1",
      "https://supabase.co/signed-url-2"
    ],
    "prompt": "Professional studio family portrait photograph of 2 family members together, soft diffused studio lighting with natural skin tones, neutral background with subtle gradient, camera at eye level, sharp focus on faces, natural expressions and poses, cohesive composition, photorealistic quality, high resolution professional photography.",
    "aspect_ratio": "4:3",
    "resolution": "2K",
    "output_format": "png",
    "safety_filter_level": "block_only_high"
  },
  "webhook": "https://yourapp.vercel.app/api/provider/callback?job_id=xxx",
  "webhook_events_filter": ["completed", "failed"]
}
```

## Commands

- `/start` - Start a new session
- `/cancel` - Cancel current session

## Inline Buttons

- **✅ Done** - Submit collected photos for processing
- **❌ Cancel** - Cancel current session
- **ℹ️ Tips** - Show tips for best results

## Error Handling

### No images
```
User: [presses ✅ Done with 0 images]
Bot: Please send at least one photo first.
```

### Too many images
```
User: [sends 15th image]
Bot: ❌ Maximum 14 photos reached. Press ✅ Done to create your portrait.
```

### Invalid file
```
User: [sends non-image file]
Bot: ❌ I couldn't use that file. Please send a JPG or PNG photo.
```

### Download timeout
```
Bot: ❌ Download took too long. Please try a smaller file or better connection.
```

### Generation failed
```
Bot: ❌ Sorry — processing failed. Please try again with /start.
```

## Configuration

No new environment variables required. Uses existing:
- `REPLICATE_KEY`
- `REPLICATE_MODEL_VERSION`
- `BASE_URL`
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `TG_TOKEN`
- `TG_WEBHOOK_SECRET`

## Migration from Old Workflow

The old single-photoone-by-one → press ✅ Done
- [ ] Send 3 photos as album (bulk) → verify consolidated message
- [ ] Send mix of single + album photos → verify correct countscessing is replaced by session-based workflow. To restore old behavior:
- Revert to `pages/api/telegram/webhook.old.ts`

## Testing Checklist

- [ ] Run database migration in Supabase
- [ ] Deploy to Vercel
- [ ] Test `/start` command
- [ ] Send 1 photo → press ✅ Done
- [ ] Send 3 photos → press ✅ Done
- [ ] Test ❌ Cancel button
- [ ] Test ℹ️ Tips button
- [ ] Test sending 0 photos → press ✅ Done (should reject)
- [ ] Test sending 15 photos (should limit to 14)
- [ ] Verify final portrait is delivered
- [ ] Check Vercel logs for errors

## Prompt Strategy

The prompt builder creates neutral, professional descriptions:
- Mentions number of family members
- Specifies studio lighting and composition
- Avoids beautification or age-modification language
- Includes safety by design (no explicit terms)

Example for 2 images:
```
Professional studio family portrait photograph of 2 family members together, soft diffused studio lighting with natural skin tones, neutral background with subtle gradient, camera at eye level, sharp focus on faces, natural expressions and poses, cohesive composition, photorealistic quality, high resolution professional photography.
```

## Observability

All sessions are logged with:
- Session ID
- Chat ID
- Image count
- Generated prompt
- Job ID (when submitted)
- Final status (done/failed/cancelled)

Check Vercel logs for:
```
[webhook] Created session <uuid> for chat <id>
[webhook] Added image to session <uuid> (N total)
[webhook] Generated prompt for session <uuid>: ...
[webhook] Started provider job <job_id> for session <uuid>
[provider/callback] Session <uuid> completed
```

## Future Enhancements

- Custom instructions field (let user specify "outdoor setting" etc.)
- Style presets (formal, casual, vintage)
- Multiple aspect ratios
- Session history (view past portraits)
- Batch processing queue for heavy load
