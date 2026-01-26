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

  const config = getConfig();
  const adminToken = req.headers['x-admin-token'];
  if (!config.ADMIN_TOKEN || adminToken !== config.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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
    // Most recent job
    const { data: recent, error: recentErr } = await supabase
      .from('jobs')
      .select('id, created_at, status, telegram_chat_id, telegram_message_id')
      .order('created_at', { ascending: false })
      .limit(1);

    if (recentErr) throw new Error(recentErr.message);

    // Count jobs in last 24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: countData, error: countErr } = await supabase
      .from('jobs')
      .select('id', { count: 'exact' })
      .gte('created_at', since);

    if (countErr) throw new Error(countErr.message);

    return res.status(200).json({
      recent: (recent && recent[0]) || null,
      last24h_count: (countData && countData.length) || 0,
    });
  } catch (error) {
    console.error('[admin/lastWebhook] Error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
}
