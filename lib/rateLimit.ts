// Simple in-memory rate limiter
// For production, use Redis or similar

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt < now) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000);

export interface RateLimitOptions {
  /** Unique identifier (e.g., IP address, user ID, chat ID) */
  identifier: string;
  /** Maximum requests allowed in the window */
  limit: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function checkRateLimit(options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const key = options.identifier;
  
  let entry = store.get(key);
  
  // No entry or expired - create new
  if (!entry || entry.resetAt < now) {
    entry = {
      count: 1,
      resetAt: now + options.windowMs,
    };
    store.set(key, entry);
    
    return {
      allowed: true,
      remaining: options.limit - 1,
      resetAt: entry.resetAt,
    };
  }
  
  // Check if limit exceeded
  if (entry.count >= options.limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
    };
  }
  
  // Increment count
  entry.count++;
  store.set(key, entry);
  
  return {
    allowed: true,
    remaining: options.limit - entry.count,
    resetAt: entry.resetAt,
  };
}

export default { checkRateLimit };
