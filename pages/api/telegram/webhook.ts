import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { getConfig } from '../../../lib/config';
import { createJob, updateJob } from '../../../lib/dbHelpers';
import {
  sendMessage,
  downloadFile,
} from '../../../lib/telegram';
import {
  uploadBuffer,
  buildJobObjectPath,
  guessContentType,
} from '../../../lib/storage';
import { startProviderJob } from '../../../lib/provider';
import { checkRateLimit } from '../../../lib/rateLimit';
import { FILE_SIZE_LIMITS } from '../../../lib/validation';
import { safeError } from '../../../lib/logger';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let chatId: number | undefined;

  try {
    // Validate Telegram signature (required in production)
    const telegramSignature = req.headers['x-telegram-bot-api-secret-token'] as string | undefined;
    const secretToken = process.env.TG_WEBHOOK_SECRET;
    const config = getConfig();

    if (config.NODE_ENV === 'production' && !secretToken) {
      console.error('[webhook] FATAL: TG_WEBHOOK_SECRET not configured in production');
      return res.status(500).json({ error: 'Server misconfigured' });
    }
    
    if (secretToken && telegramSignature !== secretToken) {
      console.error('[webhook] REJECTED: Invalid Telegram signature');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const update = req.body;

    // Extract message data
    const message = update.message || update.edited_message;
    chatId = message?.chat?.id;
    const userId = message?.from?.id;
    const messageId = message?.message_id;

    // Ignore non-message updates
    if (!message || !chatId) {
      return res.status(200).json({ ok: true });
    }

    // Rate limiting: 10 requests per minute per chat
    const rateLimit = checkRateLimit({
      identifier: `telegram:${chatId}`,
      limit: 10,
      windowMs: 60 * 1000,
    });
    
    if (!rateLimit.allowed) {
      await sendMessage(chatId, 'Please slow down. Try again in a minute.');
      return res.status(200).json({ ok: true });
    }

    // Handle /start command
    if (message.text && message.text.trim().startsWith('/start')) {
      await sendMessage(
        chatId,
        'Welcome! Send me a photo and I will process it for you.',
      );
      return res.status(200).json({ ok: true });
    }

    // Check for photo
    const photos = message.photo;
    if (!photos || photos.length === 0) {
      await sendMessage(chatId, 'Please send a photo.');
      return res.status(200).json({ ok: true });
    }

    // Select largest photo (last in array)
    const photo = photos[photos.length - 1];
    const fileId = photo.file_id;

    // Download file from Telegram
    const { buffer, file_path, file_size } = await downloadFile(fileId);
    
    // Validate file size (max 20MB)
    if (buffer.length > FILE_SIZE_LIMITS.MAX_IMAGE_SIZE) {
      await sendMessage(chatId, 'Sorry, the image is too large. Please send an image smaller than 20MB.');
      return res.status(200).json({ ok: true });
    }

    // Determine filename and extension
    let filename = 'original.jpg';
    let ext = '.jpg';
    if (file_path) {
      const pathParts = file_path.split('/');
      const basename = pathParts[pathParts.length - 1];
      if (basename) {
        filename = basename;
        const extMatch = basename.match(/\.[^.]+$/);
        ext = extMatch ? extMatch[0] : '.jpg';
      }
    }

    // Generate webhook secret for callback
    const webhookSecret = crypto.randomBytes(16).toString('hex');

    // Create job row
    const job = await createJob({
      user_id: userId?.toString(),
      telegram_chat_id: chatId.toString(),
      telegram_message_id: messageId?.toString(),
      webhook_secret: webhookSecret,
      input: {
        telegram_file_id: fileId,
        telegram_file_path: file_path,
        original_filename: filename,
        original_size_bytes: buffer.length,
      },
    });

    // Build storage path
    const objectPath = buildJobObjectPath(job.id, `original${ext}`);

    // Upload to Supabase Storage (upsert=false to prevent accidental overwrites)
    const contentType = guessContentType(filename) || 'application/octet-stream';
    const { bucket, path } = await uploadBuffer({
      path: objectPath,
      buffer,
      contentType,
      upsert: false,
    });

    // Update job with storage info
    await updateJob(job.id, {
      input: {
        ...job.input,
        storage: {
          bucket,
          path,
          content_type: contentType,
        },
      },
    });

    // Send processing message to user
    const processingMsg = await sendMessage(
      chatId,
      'Got it! Processing your photo now - I will send the result here.',
    );

    // Optionally store processing message ID for future editing
    if (processingMsg?.message_id) {
      await updateJob(job.id, {
        telegram_message_id: processingMsg.message_id.toString(),
      });
    }

    // Start the provider job
    try {
      await startProviderJob({
        jobId: job.id,
        inputImage: { bucket, path },
        modelVersion: process.env.REPLICATE_MODEL_VERSION,
      });
      console.log(`[webhook] Started provider job for ${job.id}`);
    } catch (providerError) {
      console.error('[webhook] Failed to start provider job:', providerError);
      await sendMessage(
        chatId,
        'Sorry, failed to start processing. Please try again.',
      );
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    // Log error without exposing secrets
    safeError('[webhook] Error', error);

    // Try to notify user if we have chatId
    if (chatId) {
      try {
        await sendMessage(
          chatId,
          'Sorry, something went wrong. Please try again.',
        );
      } catch (notifyError) {
        safeError('[webhook] Failed to notify user', notifyError);
      }
    }

    // Always return 200 to Telegram to avoid webhook retry storms
    return res.status(200).json({ ok: true });
  }
}
