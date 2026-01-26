// Server-only config. Never expose SUPABASE_KEY/TG_TOKEN to client bundles.
// Config validation is lazy (at request-time) to prevent build-time crashes.

import { assertEnv } from './assertEnv';

export type AppConfig = {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  TG_TOKEN: string;
  BASE_URL: string;
  REPLICATE_KEY?: string;
  STORAGE_BUCKET: string;
  ADMIN_TOKEN?: string;
  RETENTION_DAYS: number;
  POLL_INTERVAL_MS: number;
  NODE_ENV: string;
};

let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  const NODE_ENV = process.env.NODE_ENV || 'development';
  const STORAGE_BUCKET = (process.env.STORAGE_BUCKET || 'uploads').trim();

  const RETENTION_DAYS = Number.parseInt(process.env.RETENTION_DAYS || '30', 10);
  const POLL_INTERVAL_MS = Number.parseInt(process.env.POLL_INTERVAL_MS || '5000', 10);

  cachedConfig = {
    SUPABASE_URL: assertEnv('SUPABASE_URL', process.env.SUPABASE_URL),
    SUPABASE_KEY: assertEnv('SUPABASE_KEY', process.env.SUPABASE_KEY),
    TG_TOKEN: assertEnv('TG_TOKEN', process.env.TG_TOKEN),
    BASE_URL: assertEnv('BASE_URL', process.env.BASE_URL),
    REPLICATE_KEY: process.env.REPLICATE_KEY?.trim(),
    STORAGE_BUCKET,
    ADMIN_TOKEN: process.env.ADMIN_TOKEN?.trim(),
    RETENTION_DAYS: Number.isFinite(RETENTION_DAYS) && RETENTION_DAYS > 0 ? RETENTION_DAYS : 30,
    POLL_INTERVAL_MS: Number.isFinite(POLL_INTERVAL_MS) && POLL_INTERVAL_MS > 0 ? POLL_INTERVAL_MS : 5000,
    NODE_ENV,
  };

  return cachedConfig;
}

export function getRetentionMs(): number {
  return getConfig().RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

// Helper getters for convenience
export function isProd(): boolean {
  return getConfig().NODE_ENV === 'production';
}

export function isDev(): boolean {
  return !isProd();
}

// Default export for backward compatibility (lazy evaluation)
export default getConfig;
