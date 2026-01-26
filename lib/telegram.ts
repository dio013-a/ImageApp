import config from './config';

const TG_API_BASE = `https://api.telegram.org/bot${config.TG_TOKEN}`;
const TG_FILE_BASE = `https://api.telegram.org/file/bot${config.TG_TOKEN}`;

async function tgPost<T>(method: string, body: any): Promise<T> {
  const res = await fetch(`${TG_API_BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(
      `[telegram:${method}] HTTP ${res.status} ${res.statusText}`,
    );
  }

  const json = await res.json();
  if (json.ok !== true) {
    throw new Error(
      `[telegram:${method}] ${json.description || 'Unknown error'}`,
    );
  }

  return json.result as T;
}

async function tgGet<T>(methodWithQuery: string): Promise<T> {
  const res = await fetch(`${TG_API_BASE}/${methodWithQuery}`);

  if (!res.ok) {
    throw new Error(
      `[telegram:${methodWithQuery}] HTTP ${res.status} ${res.statusText}`,
    );
  }

  const json = await res.json();
  if (json.ok !== true) {
    throw new Error(
      `[telegram:${methodWithQuery}] ${json.description || 'Unknown error'}`,
    );
  }

  return json.result as T;
}

export async function sendMessage(
  chatId: string | number,
  text: string,
  options?: {
    parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
    reply_to_message_id?: number;
    disable_notification?: boolean;
    reply_markup?: any;
  },
): Promise<any> {
  return tgPost('sendMessage', {
    chat_id: chatId,
    text,
    ...options,
  });
}

export async function sendPhoto(
  chatId: string | number,
  photo: string,
  caption?: string,
  options?: {
    parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
    reply_to_message_id?: number;
    disable_notification?: boolean;
    reply_markup?: any;
  },
): Promise<any> {
  return tgPost('sendPhoto', {
    chat_id: chatId,
    photo,
    caption,
    ...options,
  });
}

export async function editMessageText(
  chatId: string | number,
  messageId: number,
  text: string,
  options?: {
    parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
    reply_markup?: any;
    disable_web_page_preview?: boolean;
  },
): Promise<any> {
  return tgPost('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...options,
  });
}

export async function getFile(
  fileId: string,
): Promise<{ file_path: string; file_size?: number }> {
  return tgGet(`getFile?file_id=${encodeURIComponent(fileId)}`);
}

export async function downloadFileByPath(filePath: string): Promise<Buffer> {
  const res = await fetch(`${TG_FILE_BASE}/${filePath}`);

  if (!res.ok) {
    throw new Error(
      `[telegram:downloadFile] HTTP ${res.status} ${res.statusText}`,
    );
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function downloadFile(fileId: string): Promise<{
  buffer: Buffer;
  file_path: string;
  file_size?: number;
}> {
  const fileInfo = await getFile(fileId);
  const buffer = await downloadFileByPath(fileInfo.file_path);

  return {
    buffer,
    file_path: fileInfo.file_path,
    file_size: fileInfo.file_size,
  };
}

export function buildFileUrl(filePath: string): string {
  return `${TG_FILE_BASE}/${filePath}`;
}

export default {
  sendMessage,
  sendPhoto,
  editMessageText,
  getFile,
  downloadFileByPath,
  downloadFile,
  buildFileUrl,
};
