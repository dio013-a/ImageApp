// Input validation utilities

export const FILE_SIZE_LIMITS = {
  MAX_IMAGE_SIZE: 20 * 1024 * 1024, // 20MB
  MAX_PROMPT_LENGTH: 2000,
};

export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

export function isValidImageType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  return ALLOWED_IMAGE_TYPES.includes(contentType.toLowerCase());
}

export function isValidFileSize(size: number): boolean {
  return size > 0 && size <= FILE_SIZE_LIMITS.MAX_IMAGE_SIZE;
}

export function sanitizePrompt(prompt: string | undefined): string | undefined {
  if (!prompt) return undefined;
  
  // Trim and limit length
  const sanitized = prompt.trim().substring(0, FILE_SIZE_LIMITS.MAX_PROMPT_LENGTH);
  
  // Return undefined if empty after trimming
  return sanitized.length > 0 ? sanitized : undefined;
}

export function validateChatId(chatId: unknown): chatId is number {
  return typeof chatId === 'number' && !isNaN(chatId);
}

export function validateUserId(userId: unknown): userId is number {
  return typeof userId === 'number' && !isNaN(userId);
}

export default {
  FILE_SIZE_LIMITS,
  ALLOWED_IMAGE_TYPES,
  isValidImageType,
  isValidFileSize,
  sanitizePrompt,
  validateChatId,
  validateUserId,
};
