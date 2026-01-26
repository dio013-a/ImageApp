// Safe logging utilities that redact sensitive information

const SENSITIVE_PATTERNS = [
  /\bsk_[a-zA-Z0-9]{20,}\b/g, // API keys starting with sk_
  /\br8_[a-zA-Z0-9]{20,}\b/g, // Replicate keys
  /\bsb_secret_[a-zA-Z0-9_]{20,}\b/g, // Supabase service role keys
  /\b\d{10}:[a-zA-Z0-9_-]{35}\b/g, // Telegram bot tokens
  /\beyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/g, // JWTs
  /bearer\s+[a-zA-Z0-9_-]{20,}/gi, // Bearer tokens
  /password["\s:=]+[^\s"]{8,}/gi, // Passwords
  /secret["\s:=]+[^\s"]{8,}/gi, // Secrets
];

const REDACTED = '[REDACTED]';

/**
 * Sanitize a string by replacing sensitive patterns
 */
export function sanitizeString(str: string): string {
  let sanitized = str;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, REDACTED);
  }
  return sanitized;
}

/**
 * Sanitize an error message
 */
export function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeString(error.message);
  }
  return sanitizeString(String(error));
}

/**
 * Safe console.error that redacts sensitive information
 */
export function safeError(prefix: string, error: unknown, context?: Record<string, any>): void {
  const sanitizedMessage = sanitizeError(error);
  
  if (context) {
    const sanitizedContext = sanitizeObject(context);
    console.error(`${prefix}:`, sanitizedMessage, sanitizedContext);
  } else {
    console.error(`${prefix}:`, sanitizedMessage);
  }
}

/**
 * Sanitize an object by redacting sensitive values
 */
export function sanitizeObject(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  
  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }
  
  if (typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // Redact known sensitive keys
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes('token') || lowerKey.includes('secret') || 
          lowerKey.includes('key') || lowerKey.includes('password') ||
          lowerKey.includes('auth')) {
        sanitized[key] = REDACTED;
      } else {
        sanitized[key] = sanitizeObject(value);
      }
    }
    return sanitized;
  }
  
  return obj;
}

/**
 * Safe console.log for debugging (redacts sensitive data)
 */
export function safeLog(prefix: string, data: any): void {
  console.log(`${prefix}:`, sanitizeObject(data));
}

export default {
  sanitizeString,
  sanitizeError,
  sanitizeObject,
  safeError,
  safeLog,
};
