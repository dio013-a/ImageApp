// Server-only config. Never expose SUPABASE_KEY/TG_TOKEN to client bundles.

import { assertEnv } from './assertEnv';

const parseNumOrDefault = (value: string | undefined, defaultVal: number): number => {
  if (!value) return defaultVal;
  const parsed = parseInt(value.trim(), 10);
  return parsed > 0 ? parsed : defaultVal;
};

const config = {
  SUPABASE_URL: assertEnv('SUPABASE_URL', process.env.SUPABASE_URL),
  SUPABASE_KEY: assertEnv('SUPABASE_KEY', process.env.SUPABASE_KEY),
  TG_TOKEN: assertEnv('TG_TOKEN', process.env.TG_TOKEN),
  BASE_URL: assertEnv('BASE_URL', process.env.BASE_URL),
  REPLICATE_KEY: process.env.REPLICATE_KEY?.trim(),
  STORAGE_BUCKET: process.env.STORAGE_BUCKET?.trim() || 'uploads',
  ADMIN_TOKEN: process.env.ADMIN_TOKEN?.trim(),
  RETENTION_DAYS: parseNumOrDefault(process.env.RETENTION_DAYS, 30),
  POLL_INTERVAL_MS: parseNumOrDefault(process.env.POLL_INTERVAL_MS, 5000),
  NODE_ENV: process.env.NODE_ENV || 'development',
};

export const IS_PROD = config.NODE_ENV === 'production';
export const IS_DEV = !IS_PROD;

export function getRetentionMs(): number {
  return config.RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

export default config;
