import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { getConfig } from '../../../lib/config';
import {
  getJobById,
  markJobSuccess,
  markJobFailed,
} from '../../../lib/dbHelpers';
import { sendMessage, sendPhoto, editMessageText } from '../../../lib/telegram';
import { storeResult } from '../../../lib/storeResult';
import { safeError } from '../../../lib/logger';
import { getSessionByJobId, updateSessionStatus } from '../../../lib/sessionHelpers';

// Disable Next's automatic body parsing - we'll handle raw body manually
export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * Read raw request body as string
 */
async function getRawBody(req: NextApiRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

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

  // Parse raw body as JSON
  let payload: any;
  try {
    const rawBody = await getRawBody(req);
    
    // Debug logging (first request only - avoid spam)
    const contentType = req.headers['content-type'] || 'unknown';
    console.log(`[provider/callback] job_id=${jobId} content-type=${contentType} body_length=${rawBody.length}`);
    
    payload = JSON.parse(rawBody);
  } catch (parseError) {
    const contentType = req.headers['content-type'] || 'unknown';
    console.error(`[provider/callback] JSON parse failed: content-type=${contentType}`);
    return res.status(400).json({ error: 'Invalid JSON' });
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

    const chatId = job.telegram_chat_id;

    // Verify webhook signature (strict enforcement)
    const webhookSignature = req.headers['x-webhook-signature'] as string | undefined;
    if (job.webhook_secret) {
      const isValid = verifyWebhookSignature(jobId, job.webhook_secret, webhookSignature);
      if (!isValid) {
        console.error(`[provider/callback] REJECTED: Invalid webhook signature for job ${jobId}`);
        return res.status(401).json({ error: 'Invalid signature' });
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

      // Update session status if exists
      try {
        const session = await getSessionByJobId(jobId);
        if (session) {
          await updateSessionStatus(session.id, 'failed', { errorMessage });
        }
      } catch (err) {
        // Continue anyway
      }

      await sendMessage(
        chatId,
        '❌ Sorry — processing failed. Please try again with /start.',
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
        retentionDays: getConfig().RETENTION_DAYS,
        providerMeta: {
          provider: 'replicate',
          provider_job_id: payload.id,
        },
      });

      // Mark job success (idempotent - handled in markJobSuccess)
      await markJobSuccess(jobId, signedUrl, payload);

      // Update session status if this job belongs to a session
      try {
        const session = await getSessionByJobId(jobId);
        if (session) {
          await updateSessionStatus(session.id, 'done');
          console.log(`[provider/callback] Session ${session.id} completed`);
        }
      } catch (sessionError) {
        console.error('[provider/callback] Session update failed:', sessionError);
        // Continue anyway
      }

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

      // Get session to determine message text
      let caption = 'Here is your photo.';
      try {
        const session = await getSessionByJobId(jobId);
        if (session && session.image_input.length > 1) {
          caption = `✅ Done. This is your professional studio family portrait from ${session.image_input.length} photos.\n\nWant a different style? Send /start to begin again.`;
        } else if (session && session.image_input.length === 1) {
          caption = '✅ Done. This is your professional studio portrait.\n\nWant to try with more photos? Send /start to begin again.';
        }
      } catch (err) {
        // Use default caption
      }

      await sendPhoto(chatId, signedUrl, caption);

      return res.status(200).json({ ok: true });
    }

    // Unknown status
    return res.status(200).json({ ok: true });
  } catch (error) {
    safeError('[provider/callback] Error', error);

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
      safeError('[provider/callback] Failed to notify user', notifyError);
    }

    // Always return 200 to provider to avoid retry storms
    return res.status(200).json({ ok: true });
  }
}
