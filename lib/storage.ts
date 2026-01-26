// Server-only storage module using Supabase service_role key.

import * as path from 'path';
import config from './config';
import { supabase } from './supabase';
import { guessContentType as utilsGuessContentType, buildJobObjectPath as utilsBuildJobObjectPath } from './utils';

// Re-export utils for convenience
export const guessContentType = utilsGuessContentType;
export const buildJobObjectPath = utilsBuildJobObjectPath;

export function defaultBucket(): string {
  return config.STORAGE_BUCKET || 'uploads';
}

export async function uploadBuffer(params: {
  bucket?: string;
  path: string;
  buffer: Buffer;
  contentType?: string;
  upsert?: boolean;
  cacheControl?: string;
}): Promise<{ bucket: string; path: string }> {
  const bucket = params.bucket ?? defaultBucket();
  const upsert = params.upsert ?? true;
  const cacheControl = params.cacheControl ?? '3600';

  const { error } = await supabase.storage.from(bucket).upload(params.path, params.buffer, {
    contentType: params.contentType,
    upsert,
    cacheControl,
  });

  if (error) {
    throw new Error(`[uploadBuffer] ${error.message}`);
  }

  return { bucket, path: params.path };
}

export async function uploadFileFromUrl(params: {
  bucket?: string;
  path: string;
  url: string;
  contentType?: string;
  upsert?: boolean;
}): Promise<{ bucket: string; path: string; bytes: number }> {
  const res = await fetch(params.url);
  if (!res.ok) {
    throw new Error(
      `[uploadFileFromUrl] HTTP ${res.status} ${res.statusText}`,
    );
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const result = await uploadBuffer({
    bucket: params.bucket,
    path: params.path,
    buffer,
    contentType: params.contentType,
    upsert: params.upsert,
  });

  return {
    bucket: result.bucket,
    path: result.path,
    bytes: buffer.length,
  };
}

export async function createSignedUrl(params: {
  bucket?: string;
  path: string;
  expiresIn?: number;
  downloadFilename?: string;
}): Promise<string> {
  const bucket = params.bucket ?? defaultBucket();
  const expiresIn = params.expiresIn ?? 300;

  const options: any = {};
  if (params.downloadFilename) {
    options.download = params.downloadFilename;
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(params.path, expiresIn, options);

  if (error || !data?.signedUrl) {
    throw new Error(`[createSignedUrl] ${error?.message || 'No signed URL returned'}`);
  }

  return data.signedUrl;
}

export async function deleteObject(params: {
  bucket?: string;
  path: string;
}): Promise<void> {
  const bucket = params.bucket ?? defaultBucket();

  const { error } = await supabase.storage.from(bucket).remove([params.path]);

  if (error) {
    throw new Error(`[deleteObject] ${error.message}`);
  }
}

export async function exists(params: {
  bucket?: string;
  path: string;
}): Promise<boolean> {
  const bucket = params.bucket ?? defaultBucket();
  const folder = path.dirname(params.path);
  const name = path.basename(params.path);

  const { data, error } = await supabase.storage
    .from(bucket)
    .list(folder === '.' ? '' : folder, {
      limit: 100,
      search: name,
    });

  if (error) {
    throw new Error(`[exists] ${error.message}`);
  }

  return data?.some((item: any) => item.name === name) ?? false;
}

export default {
  defaultBucket,
  buildJobObjectPath,
  uploadBuffer,
  uploadFileFromUrl,
  createSignedUrl,
  deleteObject,
  exists,
  guessContentType,
};
