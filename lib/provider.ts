import { getConfig } from './config';
import { markJobRunning, updateJob } from './dbHelpers';
import { createSignedUrl } from './storage';

export type ProviderName = 'replicate' | 'banana';

export interface StartJobParams {
  jobId: string;
  provider?: ProviderName;
  inputImage: { bucket?: string; path: string };
  prompt?: string;
  settings?: Record<string, any>;
  modelVersion?: string;
}

export interface StartJobResult {
  provider: ProviderName;
  providerJobId: string;
  status: 'running';
  raw: any;
}

async function startReplicateJob(params: StartJobParams): Promise<StartJobResult> {
  const config = getConfig();
  if (!config.REPLICATE_KEY) {
    throw new Error('[replicate:start] REPLICATE_KEY not configured');
  }

  // Build callback URL
  const callbackUrl = `${config.BASE_URL}/api/provider/callback?job_id=${params.jobId}`;

  // Create signed URL for input image (15 minutes)
  const signedUrl = await createSignedUrl({
    bucket: params.inputImage.bucket,
    path: params.inputImage.path,
    expiresIn: 900,
  });

  // Determine model version
  const modelVersion = params.modelVersion || process.env.REPLICATE_MODEL_VERSION;
  if (!modelVersion) {
    throw new Error('[replicate:start] modelVersion required but not provided');
  }

  // Build input object
  const input: Record<string, any> = {
    image: signedUrl,
    ...(params.settings || {}),
  };
  if (params.prompt) {
    input.prompt = params.prompt;
  }

  // Start Replicate prediction
  const res = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Token ${config.REPLICATE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: modelVersion,
      input,
      webhook: callbackUrl,
      webhook_events_filter: ['completed', 'failed'],
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(
      `[replicate:start] HTTP ${res.status} ${res.statusText}: ${errorText}`,
    );
  }

  const data = await res.json();
  if (data.error) {
    throw new Error(`[replicate:start] ${data.error}`);
  }

  if (!data.id) {
    throw new Error('[replicate:start] No prediction ID returned');
  }

  return {
    provider: 'replicate',
    providerJobId: data.id,
    status: 'running',
    raw: data,
  };
}

async function startBananaJob(params: StartJobParams): Promise<StartJobResult> {
  throw new Error('banana provider not implemented yet');
}

export async function startProviderJob(
  params: StartJobParams,
): Promise<StartJobResult> {
  const provider = params.provider || 'replicate';

  let result: StartJobResult;

  if (provider === 'replicate') {
    result = await startReplicateJob(params);
  } else if (provider === 'banana') {
    result = await startBananaJob(params);
  } else {
    throw new Error(`[startProviderJob] Unknown provider: ${provider}`);
  }

  // Update DB: mark job as running with provider info
  await markJobRunning(params.jobId, result.providerJobId);
  
  // Ensure provider field is set
  await updateJob(params.jobId, { provider });

  return result;
}

export default { startProviderJob };
