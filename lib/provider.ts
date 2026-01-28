import { getConfig } from './config';
import { markJobRunning, updateJob } from './dbHelpers';
import { createSignedUrl } from './storage';

export type ProviderName = 'replicate' | 'banana';

export interface StartJobParams {
  jobId: string;
  provider?: ProviderName;
  inputImage?: { bucket?: string; path: string }; // Legacy single image
  inputImages?: Array<{ bucket?: string; path: string }>; // Multi-image support
  prompt?: string;
  settings?: Record<string, any>;
  model?: string; // Model slug (e.g. "google/nano-banana-pro")
  modelVersion?: string; // Optional pinned version
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

  // Handle multiple images or single image
  let imageInputData: string | string[] = [];
  
  if (params.inputImages && params.inputImages.length > 0) {
    // Multi-image: create signed URLs for all images
    const signedUrls = await Promise.all(
      params.inputImages.map((img) =>
        createSignedUrl({
          bucket: img.bucket,
          path: img.path,
          expiresIn: 900,
        })
      )
    );
    imageInputData = signedUrls;
  } else if (params.inputImage) {
    // Single image (legacy)
    imageInputData = await createSignedUrl({
      bucket: params.inputImage.bucket,
      path: params.inputImage.path,
      expiresIn: 900,
    });
  }
  // Note: imageInputData can be empty array for text-only generation

  // Determine model identifier (slug or version)
  const model = params.model || process.env.REPLICATE_MODEL || 'google/nano-banana-pro';
  const modelVersion = params.modelVersion || process.env.REPLICATE_MODEL_VERSION;

  // Studio portrait prompt (fixed for professional results)
  const studioPrompt = params.prompt || 
    "a professional studio-style portrait with soft, even lighting and a neutral background. The people are sharply focused, well-groomed, and confidently posed, with natural skin tones and subtle contrast. High-resolution, polished, and suitable for corporate or personal branding use.";

  // Build input object for Nano Banana Pro
  const input: Record<string, any> = {
    prompt: studioPrompt,
    image_input: imageInputData,
    aspect_ratio: params.settings?.aspect_ratio || '4:3',
    resolution: params.settings?.resolution || '1K',
    output_format: params.settings?.output_format || 'png',
    safety_filter_level: params.settings?.safety_filter_level || 'block_only_high',
  };

  let endpoint: string;
  let payload: any;
  let mode: string;

  if (modelVersion) {
    // Version mode: use /v1/predictions with version
    mode = 'version';
    endpoint = 'https://api.replicate.com/v1/predictions';
    payload = {
      version: modelVersion,
      input,
      webhook: callbackUrl,
      webhook_events_filter: ['completed'],
    };
    console.log(`[replicate:start] mode=version version=${modelVersion.substring(0, 12)}...`);
  } else {
    // Slug mode: use /v1/models/{owner}/{name}/predictions
    mode = 'slug';
    endpoint = `https://api.replicate.com/v1/models/${model}/predictions`;
    payload = {
      input,
      webhook: callbackUrl,
      webhook_events_filter: ['completed'],
    };
    console.log(`[replicate:start] mode=slug model=${model}`);
  }

  // Log input details
  console.log(`[replicate:start] input keys: prompt, image_input[${Array.isArray(imageInputData) ? imageInputData.length : 1}], aspect_ratio=${input.aspect_ratio}, resolution=${input.resolution}, output_format=${input.output_format}, safety_filter_level=${input.safety_filter_level}`);

  // Start Replicate prediction
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Token ${config.REPLICATE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
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

  console.log(`[replicate:start] prediction created id=${data.id}`);

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
