import type { NextApiRequest, NextApiResponse } from 'next';
import { getConfig } from '../../../lib/config';
import { supabase } from '../../../lib/supabase';
import { checkRateLimit } from '../../../lib/rateLimit';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check ADMIN_TOKEN
  const config = getConfig();
  const adminToken = req.headers['x-admin-token'];
  if (!config.ADMIN_TOKEN || adminToken !== config.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Rate limiting for admin endpoints
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || 'unknown';
  const rateLimit = checkRateLimit({
    identifier: `admin:${clientIp}`,
    limit: 100,
    windowMs: 60 * 1000,
  });
  
  if (!rateLimit.allowed) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  try {
    const limitParam = req.query.limit as string | undefined;
    let limit = 20;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      limit = parsed > 0 && parsed <= 100 ? parsed : 20;
    }

    const { data, error } = await supabase
      .from('jobs')
      .select(
        'id, status, provider, created_at, updated_at, telegram_chat_id, provider_job_id, result_url, error',
      )
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(error.message);
    }

    return res.status(200).json(data ?? []);
  } catch (error) {
    console.error('[admin/jobs] Error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal error',
    });
  }
}
