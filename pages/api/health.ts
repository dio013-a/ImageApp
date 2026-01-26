import type { NextApiRequest, NextApiResponse } from 'next';
import { ensureConnected } from '../../lib/supabase';
import config from '../../lib/config';

type HealthResponse = {
  ok: boolean;
  ts: string;
  env?: string;
  uptime?: number;
  error?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<HealthResponse>,
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, ts: new Date().toISOString() });
  }

  try {
    await ensureConnected();

    res.status(200).json({
      ok: true,
      ts: new Date().toISOString(),
      env: config.NODE_ENV,
      uptime: process.uptime(),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      ts: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Health check failed',
    });
  }
}
