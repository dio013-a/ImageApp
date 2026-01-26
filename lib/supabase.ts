// Server-only Supabase client using service_role key. Never expose to client bundles.

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import config from './config';

declare global {
  // eslint-disable-next-line no-var
  var __supabase_client: SupabaseClient | undefined;
}

if (!globalThis.__supabase_client) {
  globalThis.__supabase_client = createClient(
    config.SUPABASE_URL,
    config.SUPABASE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

export const supabase = globalThis.__supabase_client;
export const supabaseServiceRole = supabase;

export async function ensureConnected(): Promise<boolean> {
  const { error } = await supabase.from('jobs').select('id').limit(1);
  if (error) {
    throw new Error('ensureConnected: ' + error.message);
  }
  return true;
}
