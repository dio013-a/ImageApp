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
import { supabase } from '../../../lib/supabase';

// ============================================================================
// TYPES & CONSTANTS
// ============================================================================

interface ImageInput {
  kind: 'photo' | 'document';
  fileId: string;
}

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

// ============================================================================
// IDEMPOTENCY HELPERS
// ============================================================================

async function isUpdateProcessed(updateId: number): Promise<boolean> {
  const { data } = await supabase
    .from('processed_updates')
    .select('update_id')
    .eq('update_id', updateId)
    .single();
  
  return !!data;
}

async function markUpdateProcessed(
  updateId: number,
  chatId?: string,
  updateType?: string,
): Promise<void> {
  await supabase
    .from('processed_updates')
    .insert({
      update_id: updateId,
      chat_id: chatId,
      update_type: updateType,
    })
    .onConflict('update_id')
    .ignore();
}

// ============================================================================
// IMAGE EXTRACTION
// ============================================================================

function extractImageInput(message: any): ImageInput | null {
  if (!message) return null;

  // Check for photo (Telegram compressed image)
  if (message.photo && Array.isArray(message.photo) && message.photo.length > 0) {
    // Choose largest photo size (last in array)
    const largestPhoto = message.photo[message.photo.length - 1];
    return {
      kind: 'photo',
      fileId: largestPhoto.file_id,
    };
  }

  // Check for document (uncompressed file)
  if (message.document) {
    const doc = message.document;
    const mimeType = doc.mime_type?.toLowerCase() || '';
    const fileName = doc.file_name?.toLowerCase() || '';

    // Accept if mime type is image/*
    if (mimeType.startsWith('image/')) {
      return {
        kind: 'document',
        fileId: doc.file_id,
      };
    }

    // Fallback: check file extension
    if (fileName.match(/\.(jpg|jpeg|png|webp|gif)$/i)) {
      return {
        kind: 'document',
        fileId: doc.file_id,
      };
    }
  }

  return null;
}

// ============================================================================
// MAIN WEBHOOK HANDLER
// ============================================================================

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const update = req.body;
  const updateId = update.update_id;

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

    // Idempotency check: skip if already processed
    if (updateId && await isUpdateProcessed(updateId)) {
      console.log(`[update] Already processed update_id=${updateId}, skipping`);
      return res.status(200).json({ ok: true });
    }

    // Determine update type and extract basic info
    const message = update.message || update.edited_message;
    const callbackQuery = update.callback_query;
    const chatId = message?.chat?.id || callbackQuery?.message?.chat?.id;
    const userId = message?.from?.id || callbackQuery?.from?.id;

    let updateType = 'unknown';
    if (message) updateType = 'message';
    else if (callbackQuery) updateType = 'callback_query';
    else if (update.edited_message) updateType = 'edited_message';

    console.log(`[update] type=${updateType} update_id=${updateId} chat_id=${chatId}`);

    // Mark as processed early to prevent retries
    if (updateId) {
      await markUpdateProcessed(updateId, chatId?.toString(), updateType);
    }

    // ========================================================================
    // DISPATCHER: Route based on update type
    // ========================================================================

    // 1. CALLBACK QUERY (button presses)
    if (callbackQuery && callbackQuery.id) {
      return handleCallbackQuery(res, callbackQuery);
    }

    // 2. MESSAGE HANDLING
    if (message && chatId) {
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

      const messageText = message.text?.trim() || '';

      // 2a. /start command - send welcome only
      if (messageText.startsWith('/start')) {
        console.log(`[start] chat_id=${chatId}`);
        return handleStartCommand(res, chatId);
      }

      // 2b. /cancel command
      if (messageText.startsWith('/cancel')) {
        console.log(`[cancel] chat_id=${chatId}`);
        return handleCancelCommand(res, chatId);
      }

      // 2c. Image upload (photo or document)
      const imageInput = extractImageInput(message);
      if (imageInput) {
        console.log(`[input] detected kind=${imageInput.kind} chat_id=${chatId} message_id=${message.message_id}`);
        return handleImageUpload(
          res,
          chatId,
          userId?.toString(),
          message.message_id,
          imageInput,
        );
      }

      // 2d. Unknown message type - provide guidance
      console.log(`[update] unhandled message type chat_id=${chatId}`);
      await sendMessage(
        chatId,
        'Please send photos or images. Send /start for instructions.',
      );
      return res.status(200).json({ ok: true });
    }

    // 3. ALL OTHER UPDATES - ignore silently
    console.log(`[update] ignored type=${updateType} update_id=${updateId}`);
    return res.status(200).json({ ok: true });

  } catch (error) {
    // Log error without exposing secrets
    safeError('[webhook] Error', error);

    // Always return 200 to Telegram to avoid webhook retry storms
    return res.status(200).json({ ok: true });
  }
}

// ============================================================================
// COMMAND HANDLERS
// ============================================================================

async function handleStartCommand(res: NextApiResponse, chatId: number) {
  const welcomeText = `Welcome! 🎬

Send me **1–14 photos** of family members.
• One person per photo is fine
• Best quality: send as **File / Document**
• When finished, press ✅ Done

I'll create a professional studio family portrait.`;

  await sendMessage(chatId, welcomeText, {
    reply_markup: SESSION_KEYBOARD,
  });

  console.log(`[start] Sent welcome to chat_id=${chatId} (no session created yet)`);
  return res.status(200).json({ ok: true });
}

async function handleCancelCommand(res: NextApiResponse, chatId: number) {
  const session = await getActiveSession(chatId.toString());
  
  if (!session) {
    await sendMessage(chatId, 'No active session to cancel. Send /start to begin.');
    console.log(`[cancel] No active session for chat_id=${chatId}`);
  } else {
    await updateSessionStatus(session.id, 'cancelled');
    await sendMessage(chatId, 'Session cancelled. Send /start to begin a new one.');
    console.log(`[cancel] Cancelled session_id=${session.id} for chat_id=${chatId}`);
  }
  
  return res.status(200).json({ ok: true });
}

// ============================================================================
// IMAGE UPLOAD HANDLER
// ============================================================================

async function handleImageUpload(
  res: NextApiResponse,
  chatId: number,
  userId: string | undefined,
  messageId: number,
  imageInput: ImageInput,
) {
  // Get active session (or create one if none exists)
  let session = await getActiveSession(chatId.toString());
  
  if (!session) {
    // Create new session on first image
    console.log(`[session] No active session, creating new for chat_id=${chatId}`);
    session = await createSession({
      chatId: chatId.toString(),
      userId,
    });
    console.log(`[session] Created session_id=${session.id} for chat_id=${chatId}`);
    
    await sendMessage(
      chatId,
      'Starting a new session. Send more photos or press ✅ Done when ready.',
      { reply_markup: SESSION_KEYBOARD },
    );
  } else {
    console.log(`[session] Active session found session_id=${session.id} status=${session.status}`);
  }

  // Check if session is still in collecting state
  if (session.status !== 'collecting') {
    await sendMessage(
      chatId,
      'Current session is already processing. Please wait or send /start for a new session.',
    );
    console.log(`[input] Session ${session.id} not in collecting state, ignoring image`);
    return res.status(200).json({ ok: true });
  }

  try {
    // Download file from Telegram with timeout (45s max)
    console.log(`[input] Downloading file_id=${imageInput.fileId} kind=${imageInput.kind}`);
    const downloadPromise = downloadFile(imageInput.fileId);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Download timeout')), 45000)
    );
    
    const { buffer, file_path, file_size } = await Promise.race([
      downloadPromise,
      timeoutPromise,
    ]);
    
    console.log(`[input] Downloaded ${buffer.length} bytes from Telegram`);
    
    // Validate file size (max 20MB)
    if (buffer.length > FILE_SIZE_LIMITS.MAX_IMAGE_SIZE) {
      await sendMessage(
        chatId,
        '❌ Image too large. Please send an image smaller than 20MB.',
      );
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

    // Build storage path (using session ID)
    const objectPath = `sessions/${session.id}/input_${session.image_input.length + 1}${ext}`;

    // Upload to Supabase Storage
    console.log(`[input] Uploading to storage path=${objectPath}`);
    const contentType = guessContentType(filename) || 'application/octet-stream';
    const { bucket, path } = await uploadBuffer({
      path: objectPath,
      buffer,
      contentType,
      upsert: false,
    });

    console.log(`[input] Uploaded to bucket=${bucket} path=${path}`);

    // Add image to session (with idempotent check via message_id)
    const sessionImageInput: SessionImageInput = {
      telegram_file_id: imageInput.fileId,
      telegram_message_id: messageId.toString(),
      storage_bucket: bucket,
      storage_path: path,
      original_filename: filename,
      added_at: new Date().toISOString(),
    };

    session = await addImageToSession(session.id, sessionImageInput);
    const imageCount = session.image_input.length;

    console.log(`[input] Added message_id=${messageId} to session_id=${session.id} (${imageCount} total)`);

    // Send confirmation
    const isDocument = imageInput.kind === 'document';
    const confirmText = isDocument
      ? `✅ Got it (${imageCount} image${imageCount > 1 ? 's' : ''}). Send more photos or press ✅ Done.`
      : `✅ Added (${imageCount}). For best quality, send as File/Document. Press ✅ Done when ready.`;

    await sendMessage(chatId, confirmText, {
      reply_markup: SESSION_KEYBOARD,
    });

  } catch (error: any) {
    safeError('[input] Image upload failed', error);
    
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
        '❌ I could not process that file. Please send a JPG or PNG photo.',
      );
    }
  }

  return res.status(200).json({ ok: true });
}

// ============================================================================
// CALLBACK QUERY HANDLER (Button Presses)
// ============================================================================

async function handleCallbackQuery(
  res: NextApiResponse,
  callbackQuery: any,
) {
  const chatId = callbackQuery.message?.chat?.id;
  const userId = callbackQuery.from?.id;
  const messageId = callbackQuery.message?.message_id;
  const callbackId = callbackQuery.id;
  const data = callbackQuery.data;

  if (!chatId || !data) {
    console.log(`[callback] Missing chat_id or data, ignoring`);
    return res.status(200).json({ ok: true });
  }

  console.log(`[callback] data=${data} chat_id=${chatId} callback_id=${callbackId}`);

  try {
    if (data === 'session:done') {
      await handleSessionDone(chatId, userId, messageId, callbackId);
    } else if (data === 'session:cancel') {
      await handleSessionCancel(chatId, messageId, callbackId);
    } else if (data === 'session:tips') {
      await handleSessionTips(chatId, callbackId);
    } else {
      console.log(`[callback] Unknown data=${data}`);
    }
  } catch (error) {
    safeError('[callback] Error handling callback query', error);
    try {
      await answerCallbackQuery(callbackId, {
        text: 'Something went wrong. Please try again.',
        show_alert: true,
      });
    } catch (answerError) {
      // Ignore if answerCallbackQuery fails (e.g., already answered or expired)
      safeError('[callback] Failed to answer callback query', answerError);
    }
  }

  return res.status(200).json({ ok: true });
}

// ============================================================================
// SESSION ACTION HANDLERS
// ============================================================================

async function handleSessionDone(
  chatId: number,
  userId: number | undefined,
  messageId: number | undefined,
  callbackId: string,
) {
  const session = await getActiveSession(chatId.toString());
  
  if (!session) {
    console.log(`[done] No active session for chat_id=${chatId}`);
    try {
      await answerCallbackQuery(callbackId, {
        text: 'No active session. Send /start to begin.',
        show_alert: true,
      });
    } catch (err) {
      safeError('[done] Failed to answer callback query', err);
    }
    return;
  }

  console.log(`[done] session_id=${session.id} status=${session.status} image_count=${session.image_input.length}`);

  const imageCount = session.image_input.length;

  // Validate image count
  if (imageCount === 0) {
    console.log(`[done] Session ${session.id} has no images, asking user to upload`);
    try {
      await answerCallbackQuery(callbackId, {
        text: 'Please send at least one photo first.',
        show_alert: true,
      });
    } catch (err) {
      safeError('[done] Failed to answer callback query', err);
    }
    return;
  }

  // Idempotency: check if already processing
  if (session.status === 'processing') {
    console.log(`[done] Session ${session.id} already processing, skipping duplicate`);
    try {
      await answerCallbackQuery(callbackId, {
        text: 'Already processing your images...',
      });
    } catch (err) {
      safeError('[done] Failed to answer callback query', err);
    }
    return;
  }

  // Update session status to processing
  await updateSessionStatus(session.id, 'processing');
  console.log(`[done] Updated session ${session.id} to processing`);

  // Remove keyboard from previous message
  if (messageId) {
    try {
      await editMessageReplyMarkup(chatId, messageId, undefined);
    } catch (err) {
      // Ignore if message is too old
    }
  }

  try {
    await answerCallbackQuery(callbackId, {
      text: `Processing ${imageCount} image${imageCount > 1 ? 's' : ''}...`,
    });
  } catch (err) {
    safeError('[done] Failed to answer callback query', err);
  }

  await sendMessage(
    chatId,
    `🎬 Creating your professional studio family portrait from ${imageCount} photo${imageCount > 1 ? 's' : ''}…\n\nThis may take a few minutes. I'll send the result here when ready.`,
  );

  // Start the generation job
  try {
    await startSessionGeneration(session.id, chatId.toString(), userId?.toString());
    console.log(`[done] Started generation for session_id=${session.id}`);
  } catch (error: any) {
    safeError('[done] Failed to start generation', error);
    await updateSessionStatus(session.id, 'failed', {
      errorMessage: error?.message || 'Failed to start generation',
    });
    
    // Check if it's the "no valid images" error
    const errorMsg = error?.message?.includes('storage paths')
      ? '❌ I could not process the images. Please resend them as File/Document and try again.'
      : '❌ I could not create the portrait. Please try again in a few minutes.';
    
    await sendMessage(chatId, errorMsg);
  }
}

async function handleSessionCancel(
  chatId: number,
  messageId: number | undefined,
  callbackId: string,
) {
  const session = await getActiveSession(chatId.toString());
  
  if (!session) {
    console.log(`[cancel] No active session for chat_id=${chatId}`);
    try {
      await answerCallbackQuery(callbackId, {
        text: 'No active session to cancel.',
      });
    } catch (err) {
      safeError('[cancel] Failed to answer callback query', err);
    }
    return;
  }

  await updateSessionStatus(session.id, 'cancelled');
  console.log(`[cancel] Cancelled session_id=${session.id}`);

  // Remove keyboard
  if (messageId) {
    try {
      await editMessageReplyMarkup(chatId, messageId, undefined);
    } catch (err) {
      // Ignore
    }
  }

  try {
    await answerCallbackQuery(callbackId, {
      text: 'Session cancelled.',
    });
  } catch (err) {
    safeError('[cancel] Failed to answer callback query', err);
  }

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

  try {
    await answerCallbackQuery(callbackId);
  } catch (err) {
    safeError('[tips] Failed to answer callback query', err);
  }
  
  await sendMessage(chatId, tipsText, { parse_mode: 'Markdown' });
  console.log(`[tips] Sent tips to chat_id=${chatId}`);
}

// ============================================================================
// SESSION GENERATION
// ============================================================================

async function startSessionGeneration(
  sessionId: string,
  chatId: string,
  userId?: string,
) {
  const session = await getActiveSession(chatId);
  
  if (!session || session.id !== sessionId) {
    throw new Error('Session not found or changed');
  }

  // Idempotency: check if job already created for this session
  if (session.job_id) {
    console.log(`[generation] Session ${sessionId} already has job ${session.job_id}, skipping duplicate`);
    return;
  }

  // Build prompt
  const prompt = buildStudioPortraitPrompt({
    imageCount: session.image_input.length,
  });

  console.log(`[generation] session_id=${sessionId} prompt="${prompt}"`);

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

  console.log(`[generation] Created job_id=${job.id} for session_id=${sessionId}`);

  // Update session with job ID and prompt
  await updateSessionStatus(sessionId, 'processing', {
    jobId: job.id,
    prompt,
  });

  // Prepare multiple images for Replicate - filter out any without valid paths
  const inputImages = session.image_input
    .filter((img) => img.storage_path && img.storage_path.trim() !== '')
    .map((img) => ({
      bucket: img.storage_bucket,
      path: img.storage_path!,
    }));

  // Fail early if no valid images
  if (inputImages.length === 0) {
    await updateSessionStatus(sessionId, 'failed', {
      errorMessage: 'No valid images with storage paths',
    });
    throw new Error('No valid images found. All images are missing storage paths.');
  }

  console.log(`[generation] Starting provider job with ${inputImages.length} images`);

  // Start provider job with multiple images
  await startProviderJob({
    jobId: job.id,
    inputImages,
    prompt,
    modelVersion: process.env.REPLICATE_MODEL_VERSION,
    settings: {
      aspect_ratio: session.aspect_ratio || '4:3',
      resolution: session.resolution || '2K',
      output_format: session.output_format || 'png',
      safety_filter_level: 'block_only_high',
    },
  });

  console.log(`[generation] Started provider job ${job.id} for session ${sessionId}`);
}
