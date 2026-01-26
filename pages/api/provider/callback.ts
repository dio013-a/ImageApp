import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import config from '../../../lib/config';
import {
  getJobById,
  markJobSuccess,
  markJobFailed,
} from '../../../lib/dbHelpers';
import { sendMessage, sendPhoto, editMessageText } from '../../../lib/telegram';
import { storeResult } from '../../../lib/storeResult';

function verifyWebhookSignature(
  jobId: string,
  webhookSecret: string | null,
  headerSignature: string | undefined,
): boolean {
  if (!webhookSecret || !headerSignature) {
    return false;
  }
  
  // Replicate sends signature as: sha256=<hash>
  // Compute expected signature
  const expectedSig = `sha256=${crypto
    .createHmac('sha256', webhookSecret)
    .update(jobId)
    .digest('hex')}`;
  
  return crypto.timingSafeEqual(
    Buffer.from(expectedSig),
    Buffer.from(headerSignature)
  );
}

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

    // Verify webhook signature (if configured)
    const webhookSignature = req.headers['x-webhook-signature'] as string | undefined;
    if (job.webhook_secret) {
      const isValid = verifyWebhookSignature(jobId, job.webhook_secret, webhookSignature);
      if (!isValid) {
        console.warn(`[provider/callback] Invalid webhook signature for job ${jobId}`);
        // Still process for backward compatibility, but log warning
        // In production, you might want to reject: return res.status(401).json({ error: 'Invalid signature' });
      }
    }

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

      // Use storeResult to handle image storage and metadata
      const { signedUrl } = await storeResult({
        jobId,
        source: { url: outputUrl },
        variantName: 'final',
        retentionDays: config.RETENTION_DAYS,
        providerMeta: {
          provider: 'replicate',
          provider_job_id: payload.id,
        },
      });

      // Mark job success (idempotent - handled in markJobSuccess)
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
