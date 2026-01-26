import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { getConfig } from '../../../lib/config';
import { createJob } from '../../../lib/dbHelpers';
import {
  sendMessage,
  downloadFile,
  answerCallbackQuery,
  editMessageReplyMarkup,
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
import {
  getActiveSession,
  createSession,
  addImageToSession,
  updateSessionStatus,
  type SessionImageInput,
} from '../../../lib/sessionHelpers';
import { buildStudioPortraitPrompt } from '../../../lib/promptBuilder';

// Inline keyboard for session management
const SESSION_KEYBOARD = {
  inline_keyboard: [
    [
      { text: '✅ Done', callback_data: 'session:done' },
      { text: '❌ Cancel', callback_data: 'session:cancel' },
    ],
    [{ text: 'ℹ️ Tips', callback_data: 'session:tips' }],
  ],
};

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

    // Handle callback queries (button presses)
    if (update.callback_query) {
      return handleCallbackQuery(req, res, update.callback_query);
    }

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
      return handleStartCommand(chatId, userId);
    }

    // Handle /cancel command
    if (message.text && message.text.trim().startsWith('/cancel')) {
      return handleCancelCommand(chatId);
    }

    // Check for photo or document (document can be high-quality image)
    const photos = message.photo;
    const document = message.document;
    
    let fileId: string | null = null;
    let isDocument = false;
    
    if (photos && photos.length > 0) {
      // Select largest photo (last in array)
      fileId = photos[photos.length - 1].file_id;
    } else if (document && isImageDocument(document)) {
      fileId = document.file_id;
      isDocument = true;
    }

    if (!fileId) {
      await sendMessage(chatId, 'Please send a photo or image file.');
      return res.status(200).json({ ok: true });
    }

    // Handle image collection for session
    return handleImageUpload(chatId, userId?.toString(), messageId, fileId, isDocument);

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

async function handleStartCommand(chatId: number, userId?: number) {
  // Create new session
  const session = await createSession({
    chatId: chatId.toString(),
    userId: userId?.toString(),
  });

  const welcomeText = `Welcome! 🎬

Send me **1–14 photos** of family members.
• One person per photo is fine
• Best quality: send as **File / Document**
• When finished, press ✅ Done

I'll create a professional studio family portrait.`;

  await sendMessage(chatId, welcomeText, {
    reply_markup: SESSION_KEYBOARD,
  });

  console.log(`[webhook] Created session ${session.id} for chat ${chatId}`);
  return { ok: true };
}

async function handleCancelCommand(chatId: number) {
  const session = await getActiveSession(chatId.toString());
  
  if (!session) {
    await sendMessage(chatId, 'No active session to cancel. Send /start to begin.');
    return { ok: true };
  }

  await updateSessionStatus(session.id, 'cancelled');
  await sendMessage(chatId, 'Session cancelled. Send /start to begin a new one.');
  
  return { ok: true };
}

async function handleImageUpload(
  chatId: number,
  userId: string | undefined,
  messageId: number | undefined,
  fileId: string,
  isDocument: boolean,
) {
  // Get or create session
  let session = await getActiveSession(chatId.toString());
  
  if (!session) {
    // Auto-create session if user sends photo without /start
    session = await createSession({
      chatId: chatId.toString(),
      userId,
    });
    
    await sendMessage(
      chatId,
      'Starting a new session. Send more photos or press ✅ Done when ready.',
      { reply_markup: SESSION_KEYBOARD },
    );
  }

  // Check if session is still in collecting state
  if (session.status !== 'collecting') {
    await sendMessage(
      chatId,
      'Current session is already processing. Please wait or send /start for a new session.',
    );
    return { ok: true };
  }

  try {
    // Download file from Telegram with timeout (45s max)
    const downloadPromise = downloadFile(fileId);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Download timeout')), 45000)
    );
    
    const { buffer, file_path, file_size } = await Promise.race([
      downloadPromise,
      timeoutPromise,
    ]);
    
    // Validate file size (max 20MB)
    if (buffer.length > FILE_SIZE_LIMITS.MAX_IMAGE_SIZE) {
      await sendMessage(
        chatId,
        '❌ Image too large. Please send an image smaller than 20MB.',
      );
      return { ok: true };
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

    // Build storage path (using session ID)
    const objectPath = `sessions/${session.id}/input_${session.image_input.length + 1}${ext}`;

    // Upload to Supabase Storage
    const contentType = guessContentType(filename) || 'application/octet-stream';
    const { bucket, path } = await uploadBuffer({
      path: objectPath,
      buffer,
      contentType,
      upsert: false,
    });

    // Add image to session
    const imageInput: SessionImageInput = {
      telegram_file_id: fileId,
      telegram_message_id: messageId?.toString() || '',
      storage_bucket: bucket,
      storage_path: path,
      original_filename: filename,
      added_at: new Date().toISOString(),
    };

    session = await addImageToSession(session.id, imageInput);
    const imageCount = session.image_input.length;

    // Send confirmation
    const confirmText = isDocument
      ? `✅ Got it (${imageCount} image${imageCount > 1 ? 's' : ''}). Send more photos or press ✅ Done.`
      : `✅ Added (${imageCount}). For best quality, send as File/Document. Press ✅ Done when ready.`;

    await sendMessage(chatId, confirmText, {
      reply_markup: SESSION_KEYBOARD,
    });

    console.log(`[webhook] Added image to session ${session.id} (${imageCount} total)`);

  } catch (error: any) {
    console.error('[webhook] Image upload failed:', error);
    
    if (error.message === 'Download timeout') {
      await sendMessage(
        chatId,
        '❌ Download took too long. Please try a smaller file or better connection.',
      );
    } else if (error.message?.includes('Maximum 14 images')) {
      await sendMessage(
        chatId,
        '❌ Maximum 14 photos reached. Press ✅ Done to create your portrait.',
      );
    } else {
      await sendMessage(
        chatId,
        '❌ I couldn't use that file. Please send a JPG or PNG photo.',
      );
    }
  }

  return { ok: true };
}

async function handleCallbackQuery(
  req: NextApiRequest,
  res: NextApiResponse,
  callbackQuery: any,
) {
  const chatId = callbackQuery.message?.chat?.id;
  const userId = callbackQuery.from?.id;
  const messageId = callbackQuery.message?.message_id;
  const callbackId = callbackQuery.id;
  const data = callbackQuery.data;

  if (!chatId || !data) {
    return res.status(200).json({ ok: true });
  }

  try {
    if (data === 'session:done') {
      await handleSessionDone(chatId, userId, messageId, callbackId);
    } else if (data === 'session:cancel') {
      await handleSessionCancel(chatId, messageId, callbackId);
    } else if (data === 'session:tips') {
      await handleSessionTips(chatId, callbackId);
    }
  } catch (error) {
    safeError('[webhook] Callback query error', error);
    await answerCallbackQuery(callbackId, {
      text: 'Something went wrong. Please try again.',
      show_alert: true,
    });
  }

  return res.status(200).json({ ok: true });
}

async function handleSessionDone(
  chatId: number,
  userId: number | undefined,
  messageId: number | undefined,
  callbackId: string,
) {
  const session = await getActiveSession(chatId.toString());
  
  if (!session) {
    await answerCallbackQuery(callbackId, {
      text: 'No active session. Send /start to begin.',
      show_alert: true,
    });
    return;
  }

  const imageCount = session.image_input.length;

  // Validate image count
  if (imageCount === 0) {
    await answerCallbackQuery(callbackId, {
      text: 'Please send at least one photo first.',
      show_alert: true,
    });
    return;
  }

  // Update session status to processing
  await updateSessionStatus(session.id, 'processing');

  // Remove keyboard from previous message
  if (messageId) {
    try {
      await editMessageReplyMarkup(chatId, messageId, undefined);
    } catch (err) {
      // Ignore if message is too old
    }
  }

  await answerCallbackQuery(callbackId, {
    text: `Processing ${imageCount} image${imageCount > 1 ? 's' : ''}...`,
  });

  await sendMessage(
    chatId,
    `🎬 Creating your professional studio family portrait from ${imageCount} photo${imageCount > 1 ? 's' : ''}…\n\nThis may take a few minutes. I'll send the result here when ready.`,
  );

  // Start the generation job
  try {
    await startSessionGeneration(session.id, chatId.toString(), userId?.toString());
  } catch (error) {
    console.error('[webhook] Failed to start generation:', error);
    await updateSessionStatus(session.id, 'failed', {
      errorMessage: 'Failed to start generation',
    });
    await sendMessage(
      chatId,
      '❌ I couldn't create the portrait. Please try again in a few minutes.',
    );
  }
}

async function handleSessionCancel(
  chatId: number,
  messageId: number | undefined,
  callbackId: string,
) {
  const session = await getActiveSession(chatId.toString());
  
  if (!session) {
    await answerCallbackQuery(callbackId, {
      text: 'No active session to cancel.',
    });
    return;
  }

  await updateSessionStatus(session.id, 'cancelled');

  // Remove keyboard
  if (messageId) {
    try {
      await editMessageReplyMarkup(chatId, messageId, undefined);
    } catch (err) {
      // Ignore
    }
  }

  await answerCallbackQuery(callbackId, {
    text: 'Session cancelled.',
  });

  await sendMessage(chatId, 'Session cancelled. Send /start to begin a new one.');
}

async function handleSessionTips(chatId: number, callbackId: string) {
  const tipsText = `📸 **Tips for best results:**

• Send clear, well-lit photos
• One person per photo works great
• Send as File/Document for highest quality
• Include all family members you want in the portrait
• Up to 14 photos total

Press ✅ Done when ready!`;

  await answerCallbackQuery(callbackId);
  await sendMessage(chatId, tipsText, { parse_mode: 'Markdown' });
}

async function startSessionGeneration(
  sessionId: string,
  chatId: string,
  userId?: string,
) {
  const session = await getActiveSession(chatId);
  
  if (!session || session.id !== sessionId) {
    throw new Error('Session not found or changed');
  }

  // Build prompt
  const prompt = buildStudioPortraitPrompt({
    imageCount: session.image_input.length,
  });

  console.log(`[webhook] Generated prompt for session ${sessionId}: ${prompt}`);

  // Generate webhook secret for callback
  const webhookSecret = crypto.randomBytes(16).toString('hex');

  // Create job row
  const job = await createJob({
    user_id: userId,
    telegram_chat_id: chatId,
    webhook_secret: webhookSecret,
    input: {
      session_id: sessionId,
      image_count: session.image_input.length,
      prompt,
    },
  });

  // Update session with job ID and prompt
  await updateSessionStatus(sessionId, 'processing', {
    jobId: job.id,
    prompt,
  });

  // Prepare multiple images for Replicate
  const inputImages = session.image_input.map((img) => ({
    bucket: img.storage_bucket,
    path: img.storage_path,
  }));

  // Start provider job with multiple images
  await startProviderJob({
    jobId: job.id,
    inputImages, // Pass array of images
    prompt,
    modelVersion: process.env.REPLICATE_MODEL_VERSION,
    settings: {
      aspect_ratio: session.aspect_ratio || '4:3',
      resolution: session.resolution || '2K',
      output_format: session.output_format || 'png',
      safety_filter_level: 'block_only_high',
    },
  });

  console.log(`[webhook] Started provider job ${job.id} for session ${sessionId}`);
}

function isImageDocument(document: any): boolean {
  const mimeType = document.mime_type?.toLowerCase() || '';
  return (
    mimeType.startsWith('image/') ||
    mimeType === 'image/jpeg' ||
    mimeType === 'image/png' ||
    mimeType === 'image/jpg'
  );
}
