import { supabase } from './supabase';

export type JobStatus = 'pending' | 'running' | 'success' | 'failed';

export interface JobRow {
  id: string;
  user_id: string | null;
  telegram_chat_id: string;
  telegram_message_id: string | null;
  provider: string | null;
  provider_job_id: string | null;
  status: JobStatus;
  attempts: number;
  input: any;
  output: any;
  result_url: string | null;
  error: string | null;
  webhook_secret: string | null;
  created_at: string;
  updated_at: string;
}

export interface ImageRow {
  id: string;
  job_id: string;
  variant_name: string;
  mime: string | null;
  filesize: number | null;
  width: number | null;
  height: number | null;
  file_hash: string | null;
  storage_bucket: string;
  storage_path: string;
  public_url: string | null;
  meta: any;
  retention_expires_at: string;
  is_original: boolean;
  version: number;
  created_at: string;
}

export async function createJob(params: {
  user_id?: string;
  telegram_chat_id: string;
  telegram_message_id?: string;
  provider?: string;
  input?: any;
  webhook_secret?: string;
}): Promise<JobRow> {
  const { data, error } = await supabase
    .from('jobs')
    .insert({
      user_id: params.user_id ?? null,
      telegram_chat_id: params.telegram_chat_id,
      telegram_message_id: params.telegram_message_id ?? null,
      provider: params.provider ?? null,
      input: params.input ?? {},
      webhook_secret: params.webhook_secret ?? null,
      status: 'pending',
      attempts: 0,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`[createJob] ${error.message}`);
  }
  return data;
}

export async function getJobById(id: string): Promise<JobRow | null> {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error(`[getJobById] ${error.message}`);
  }
  return data;
}

export async function updateJob(
  id: string,
  patch: Partial<JobRow>,
): Promise<JobRow> {
  const { data, error } = await supabase
    .from('jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`[updateJob] ${error.message}`);
  }
  return data;
}

export async function listPendingJobs(limit = 50): Promise<JobRow[]> {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .in('status', ['pending', 'running'])
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`[listPendingJobs] ${error.message}`);
  }
  return data ?? [];
}

export async function markJobRunning(
  id: string,
  providerJobId?: string,
): Promise<JobRow> {
  const { data, error } = await supabase
    .from('jobs')
    .update({
      status: 'running',
      provider_job_id: providerJobId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`[markJobRunning] ${error.message}`);
  }
  return data;
}

// Callbacks can fire twice; idempotency prevents double Telegram sends.
export async function markJobSuccess(
  id: string,
  resultUrl: string,
  output?: any,
): Promise<JobRow> {
  const existing = await getJobById(id);
  if (!existing) {
    throw new Error(`[markJobSuccess] Job not found: ${id}`);
  }
  if (existing.status === 'success') {
    return existing;
  }

  const { data, error } = await supabase
    .from('jobs')
    .update({
      status: 'success',
      result_url: resultUrl,
      output: output ?? existing.output,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`[markJobSuccess] ${error.message}`);
  }
  return data;
}

export async function markJobFailed(
  id: string,
  errorMessage: string,
): Promise<JobRow> {
  const { data, error } = await supabase
    .from('jobs')
    .update({
      status: 'failed',
      error: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`[markJobFailed] ${error.message}`);
  }
  return data;
}

export async function insertImage(params: {
  job_id: string;
  variant_name?: string;
  mime?: string | null;
  filesize?: number | null;
  width?: number | null;
  height?: number | null;
  file_hash?: string | null;
  storage_bucket?: string | null;
  storage_path?: string;
  meta?: any;
  retention_days?: number;
  is_original?: boolean;
  version?: number;
  public_url?: string | null;
}): Promise<ImageRow> {
  const days = params.retention_days ?? 30;
  const retention_expires_at = new Date(
    Date.now() + days * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await supabase
    .from('images')
    .insert({
      job_id: params.job_id,
      variant_name: params.variant_name ?? 'final',
      mime: params.mime ?? null,
      filesize: params.filesize ?? null,
      width: params.width ?? null,
      height: params.height ?? null,
      file_hash: params.file_hash ?? null,
      storage_bucket: params.storage_bucket ?? 'uploads',
      storage_path: params.storage_path ?? '',
      public_url: params.public_url ?? null,
      meta: params.meta ?? {},
      retention_expires_at,
      is_original: params.is_original ?? false,
      version: params.version ?? 1,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`[insertImage] ${error.message}`);
  }
  return data;
}

export async function getImageById(id: string): Promise<ImageRow | null> {
  const { data, error } = await supabase
    .from('images')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error(`[getImageById] ${error.message}`);
  }
  return data;
}

export async function deleteImageById(id: string): Promise<void> {
  const { error } = await supabase.from('images').delete().eq('id', id);
  if (error) {
    throw new Error(`[deleteImageById] ${error.message}`);
  }
}
