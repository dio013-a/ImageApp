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

/**
 * Validate and sanitize URLs for SSRF protection
 * Only allows HTTPS URLs from trusted domains (Replicate delivery)
 */
export function isValidProviderUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    
    // Only allow HTTPS
    if (parsed.protocol !== 'https:') {
      return false;
    }
    
    // Allowlist trusted provider domains
    const allowedDomains = [
      'replicate.delivery',
      'replicate.com',
      // Add other trusted provider domains here
    ];
    
    const hostname = parsed.hostname.toLowerCase();
    const isAllowed = allowedDomains.some(domain => 
      hostname === domain || hostname.endsWith(`.${domain}`)
    );
    
    if (!isAllowed) {
      console.warn(`[validation] Rejected untrusted domain: ${hostname}`);
      return false;
    }
    
    // Reject localhost, private IPs, and internal domains
    const privatePatterns = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^169\.254\./,
      /^::1$/,
      /^fc00:/,
      /^fe80:/,
    ];
    
    if (privatePatterns.some(pattern => pattern.test(hostname))) {
      console.warn(`[validation] Rejected private/internal address: ${hostname}`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.warn(`[validation] Invalid URL format: ${error instanceof Error ? error.message : 'unknown'}`);
    return false;
  }
}

export default {
  FILE_SIZE_LIMITS,
  ALLOWED_IMAGE_TYPES,
  isValidImageType,
  isValidFileSize,
  sanitizePrompt,
  validateChatId,
  validateUserId,
  isValidProviderUrl,
};
