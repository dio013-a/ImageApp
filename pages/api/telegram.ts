import type { NextApiRequest, NextApiResponse } from 'next';
import { getConfig } from '../../lib/config';

/**
 * Telegram webhook handler
 * Endpoint: /api/telegram
 * 
 * Purpose:
 * - Receive webhook updates from Telegram
 * - Respond to /start command with a confirmation message
 * - Log all incoming updates
 * - Always return 200 OK quickly
 */

interface TelegramMessage {
  message_id: number;
  from?: {
    id: number;
    first_name: string;
    username?: string;
  };
  chat: {
    id: number;
    type: string;
  };
  text?: string;
  date: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  let botToken: string | undefined;

  try {
    botToken = getConfig().TG_TOKEN;
  } catch (err) {
    console.error('[telegram] ERROR: TG_TOKEN not configured');
    // Fail loudly but safely: do not throw so the webhook returns 200 to Telegram
    return;
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
      }),
    });

    const data = await response.json();
    
    if (!response.ok || !data.ok) {
      console.error('[telegram] Failed to send message:', data);
      // Log error but don't throw to keep webhook responses 200
      return;
    }
    
    console.log('[telegram] Message sent successfully to chat', chatId);
  } catch (error) {
    console.error('[telegram] Error sending message:', error);
    // Don't rethrow: handler will still return 200 to Telegram
    return;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Handle GET requests (for browser testing)
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      message: 'Telegram webhook endpoint is active',
      timestamp: new Date().toISOString(),
    });
  }

  // Only accept POST requests from Telegram
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const update: TelegramUpdate = req.body;
    
    // Log the full incoming update
    console.log('[telegram] Received update:', JSON.stringify(update, null, 2));

    // Extract message (could be a regular message or edited message)
    const message = update.message || update.edited_message;

    // If no message, acknowledge and return
    if (!message) {
      console.log('[telegram] Update has no message, ignoring');
      return res.status(200).json({ ok: true });
    }

    const chatId = message.chat.id;
    const text = message.text?.trim() || '';

    console.log('[telegram] Processing message:', {
      chatId,
      text,
      from: message.from?.username || message.from?.first_name,
    });

    // Handle /start command
    if (text.startsWith('/start')) {
      console.log('[telegram] /start command detected, sending welcome message');
      
      await sendTelegramMessage(
        chatId,
        'Бот на связи ✅\n\nWelcome! The bot is now connected and ready.'
      );
      
      return res.status(200).json({ ok: true });
    }

    // For any other message, just acknowledge
    console.log('[telegram] Message received (no action taken)');
    return res.status(200).json({ ok: true });

  } catch (error) {
    // Log error but still return 200 to prevent Telegram retries
    console.error('[telegram] Error processing update:', error);
    return res.status(200).json({ ok: true, error: 'Internal error logged' });
  }
}
