import type { NextApiRequest, NextApiResponse } from 'next';
import config from '../../../lib/config';
import {
  getJobById,
  markJobSuccess,
  markJobFailed,
  insertImage,
} from '../../../lib/dbHelpers';
import {
  uploadFileFromUrl,
  buildJobObjectPath,
  guessContentType,
  createSignedUrl,
} from '../../../lib/storage';
import { sendMessage, sendPhoto, editMessageText } from '../../../lib/telegram';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const jobId = req.query.job_id as string | undefined;

  // Missing job_id - ignore
  if (!jobId) {
    return res.status(200).json({ ok: true });
  }

  try {
    // Fetch job
    const job = await getJobById(jobId);
    if (!job) {
      console.log(`[provider/callback] Job not found: ${jobId}`);
      return res.status(200).json({ ok: true });
    }

    // Idempotency check - already completed
    if (job.status === 'success') {
      console.log(`[provider/callback] Job already succeeded: ${jobId}`);
      return res.status(200).json({ ok: true });
    }

    const payload = req.body;
    const chatId = job.telegram_chat_id;

    // TODO: Webhook signature verification (check job.webhook_secret vs header)

    // Parse Replicate payload
    const status = payload.status;
    const output = payload.output;
    const error = payload.error;

    // Ignore non-terminal statuses
    if (
      status !== 'succeeded' &&
      status !== 'failed' &&
      status !== 'canceled'
    ) {
      return res.status(200).json({ ok: true });
    }

    // Handle failure
    if (status === 'failed' || status === 'canceled') {
      const errorMessage = error || `Provider status: ${status}`;
      await markJobFailed(jobId, errorMessage);

      await sendMessage(
        chatId,
        'Sorry — processing failed. Please try again.',
      );

      return res.status(200).json({ ok: true });
    }

    // Handle success
    if (status === 'succeeded') {
      // Extract output URL
      let outputUrl: string | null = null;
      if (typeof output === 'string') {
        outputUrl = output;
      } else if (Array.isArray(output) && output.length > 0) {
        outputUrl = output[0];
      }

      if (!outputUrl) {
        await markJobFailed(jobId, 'No output URL from provider');
        await sendMessage(
          chatId,
          'Sorry — no image output received. Please try again.',
        );
        return res.status(200).json({ ok: true });
      }

      // Infer extension from URL
      let ext = '.jpg';
      const urlLower = outputUrl.toLowerCase();
      if (urlLower.endsWith('.png')) {
        ext = '.png';
      } else if (urlLower.endsWith('.webp')) {
        ext = '.webp';
      }

      // Build storage path
      const storagePath = buildJobObjectPath(jobId, `final${ext}`);
      const contentType = guessContentType(storagePath) || 'image/jpeg';

      // Upload provider output to Supabase Storage
      const { bucket, path, bytes } = await uploadFileFromUrl({
        path: storagePath,
        url: outputUrl,
        contentType,
        upsert: true,
      });

      // Insert image row
      await insertImage({
        job_id: jobId,
        variant_name: 'final',
        storage_bucket: bucket,
        storage_path: path,
        public_url: null,
        filesize: bytes,
        meta: {
          provider: 'replicate',
          provider_job_id: payload.id,
        },
        retention_days: config.RETENTION_DAYS,
        is_original: false,
        version: 1,
      });

      // Create signed URL for Telegram
      const signedUrl = await createSignedUrl({
        bucket,
        path,
        expiresIn: 300,
      });

      // Mark job success (idempotent)
      await markJobSuccess(jobId, signedUrl, payload);

      // Notify Telegram
      const messageId = job.telegram_message_id;
      if (messageId && !isNaN(Number(messageId))) {
        try {
          await editMessageText(
            chatId,
            Number(messageId),
            'Done ✅',
          );
        } catch (editError) {
          // Best-effort, ignore errors
          console.log('[provider/callback] Could not edit message:', editError);
        }
      }

      await sendPhoto(chatId, signedUrl, 'Here is your photo.');

      return res.status(200).json({ ok: true });
    }

    // Unknown status
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(
      '[provider/callback] Error:',
      error instanceof Error ? error.message : String(error),
    );

    // Try to notify user if we have job info
    try {
      const job = await getJobById(jobId!);
      if (job?.telegram_chat_id) {
        await sendMessage(
          job.telegram_chat_id,
          'Sorry — something went wrong processing your image.',
        );
      }
    } catch (notifyError) {
      console.error('[provider/callback] Failed to notify user:', notifyError);
    }

    // Always return 200 to provider to avoid retry storms
    return res.status(200).json({ ok: true });
  }
}
