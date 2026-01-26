import type { NextApiRequest, NextApiResponse } from 'next';
import config from '../../../lib/config';
import { supabase } from '../../../lib/supabase';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check ADMIN_TOKEN
  const adminToken = req.headers['x-admin-token'];
  if (!config.ADMIN_TOKEN || adminToken !== config.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const limitParam = req.query.limit as string | undefined;
    let limit = 20;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      limit = parsed > 0 && parsed <= 100 ? parsed : 20;
    }

    const { data, error } = await supabase
      .from('images')
      .select(
        'id, job_id, variant_name, storage_bucket, storage_path, retention_expires_at, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(error.message);
    }

    return res.status(200).json(data ?? []);
  } catch (error) {
    console.error('[admin/images] Error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal error',
    });
  }
}
