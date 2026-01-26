import crypto from 'crypto';
import sharp from 'sharp';
import config from './config';
import { insertImage, updateJob, getJobById } from './dbHelpers';
import {
  uploadBuffer,
  buildJobObjectPath,
  createSignedUrl,
  guessContentType,
} from './storage';

export type ResultSource =
  | { url: string }
  | { buffer: Buffer; filename?: string; contentType?: string };

export interface StoreResultParams {
  jobId: string;
  source: ResultSource;
  variantName?: 'final' | 'thumb' | 'preview';
  filename?: string;
  retentionDays?: number;
  providerMeta?: Record<string, any>;
}

export interface StoreResultOutput {
  bucket: string;
  path: string;
  imageRow: any;
  signedUrl: string;
  meta: {
    bytes: number;
    width?: number;
    height?: number;
    mime?: string;
    sha256?: string;
  };
}

function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function inferExtFromFilenameOrMime(
  filename?: string,
  mime?: string,
): string {
  if (filename) {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.png')) return '.png';
    if (lower.endsWith('.webp')) return '.webp';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return '.jpg';
  }
  if (mime) {
    if (mime.includes('png')) return '.png';
    if (mime.includes('webp')) return '.webp';
  }
  return '.jpg';
}

export async function storeResult(
  params: StoreResultParams,
): Promise<StoreResultOutput> {
  try {
    const variantName = params.variantName ?? 'final';
    const retentionDays = params.retentionDays ?? config.RETENTION_DAYS;

    // Determine filename
    let filename: string;
    if (params.filename) {
      filename = params.filename;
    } else {
      const ext =
        'buffer' in params.source
          ? inferExtFromFilenameOrMime(
              params.source.filename,
              params.source.contentType,
            )
          : '.jpg';
      filename = `${variantName}${ext}`;
    }

    // Build storage path
    const path = buildJobObjectPath(params.jobId, filename);

    // Obtain buffer
    let buffer: Buffer;
    let sourceContentType: string | undefined;

    if ('url' in params.source) {
      // Download from URL
      const res = await fetch(params.source.url);
      if (!res.ok) {
        throw new Error(
          `[storeResult] download failed: HTTP ${res.status} ${res.statusText}`,
        );
      }
      const arrayBuffer = await res.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } else {
      // Use provided buffer
      buffer = params.source.buffer;
      sourceContentType = params.source.contentType;
    }

    const bytes = buffer.length;

    // Compute metadata
    const hash = sha256(buffer);

    let width: number | undefined;
    let height: number | undefined;
    try {
      const metadata = await sharp(buffer).metadata();
      width = metadata.width;
      height = metadata.height;
    } catch (sharpError) {
      // Best-effort, ignore if sharp fails
      console.warn('[storeResult] sharp metadata failed:', sharpError);
    }

    const mime =
      sourceContentType || guessContentType(filename) || 'image/jpeg';

    // Upload to Supabase Storage
    const { bucket } = await uploadBuffer({
      path,
      buffer,
      contentType: mime,
      upsert: true,
    });

    // Insert images row
    const imageRow = await insertImage({
      job_id: params.jobId,
      variant_name: variantName,
      mime,
      filesize: bytes,
      width,
      height,
      file_hash: hash,
      storage_bucket: bucket,
      storage_path: path,
      public_url: null,
      meta: {
        ...(params.providerMeta || {}),
        stored_at: new Date().toISOString(),
      },
      retention_days: retentionDays,
      is_original: false,
      version: 1,
    });

    // Create signed URL for Telegram
    const signedUrl = await createSignedUrl({
      bucket,
      path,
      expiresIn: 300,
    });

    // Update job with result info
    const job = await getJobById(params.jobId);
    if (job) {
      await updateJob(params.jobId, {
        result_url: signedUrl,
        output: {
          ...(job.output || {}),
          storage: { bucket, path },
          last_image_id: imageRow.id,
        },
      });
    }

    return {
      bucket,
      path,
      imageRow,
      signedUrl,
      meta: {
        bytes,
        width,
        height,
        mime,
        sha256: hash,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('[storeResult]')) {
      throw error;
    }
    throw new Error(
      `[storeResult] ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export default { storeResult };
