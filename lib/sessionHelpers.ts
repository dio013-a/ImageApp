import { getSupabase } from './supabase';

export type SessionStatus = 'collecting' | 'processing' | 'done' | 'failed' | 'cancelled';

export interface SessionImageInput {
  telegram_file_id: string;
  telegram_message_id: string;
  storage_bucket?: string;
  storage_path?: string;
  original_filename?: string;
  added_at: string;
}

export interface Session {
  id: string;
  created_at: string;
  updated_at: string;
  telegram_chat_id: string;
  telegram_user_id?: string;
  status: SessionStatus;
  image_input: SessionImageInput[];
  prompt?: string;
  aspect_ratio?: string;
  resolution?: string;
  output_format?: string;
  job_id?: string;
  image_count?: number;
  error_message?: string;
}

/**
 * Get active session for a chat (collecting or processing)
 */
export async function getActiveSession(chatId: string): Promise<Session | null> {
  const supabase = getSupabase();
  
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('telegram_chat_id', chatId)
    .in('status', ['collecting', 'processing'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') {
      // No rows found
      return null;
    }
    throw error;
  }
  
  return data as Session;
}

/**
 * Create a new session
 */
export async function createSession(params: {
  chatId: string;
  userId?: string;
}): Promise<Session> {
  const supabase = getSupabase();
  
  const { data, error } = await supabase
    .from('sessions')
    .insert({
      telegram_chat_id: params.chatId,
      telegram_user_id: params.userId,
      status: 'collecting',
      image_input: [],
    })
    .select()
    .single();
  
  if (error) {
    throw new Error(`Failed to create session: ${error.message}`);
  }
  
  return data as Session;
}

/**
 * Add image to session
 */
export async function addImageToSession(
  sessionId: string,
  imageInput: SessionImageInput,
): Promise<Session> {
  const supabase = getSupabase();
  
  // First, get current session to check image count
  const { data: session, error: fetchError } = await supabase
    .from('sessions')
    .select('image_input')
    .eq('id', sessionId)
    .single();
  
  if (fetchError) {
    throw new Error(`Failed to fetch session: ${fetchError.message}`);
  }
  
  const currentImages = (session.image_input as SessionImageInput[]) || [];
  
  // Check for duplicates (by telegram_message_id)
  const isDuplicate = currentImages.some(
    (img) => img.telegram_message_id === imageInput.telegram_message_id,
  );
  
  if (isDuplicate) {
    console.log(`[session] Image already added (message_id: ${imageInput.telegram_message_id})`);
    return session as Session;
  }
  
  // Check limit
  if (currentImages.length >= 14) {
    throw new Error('Maximum 14 images allowed per session');
  }
  
  // Append new image
  const updatedImages = [...currentImages, imageInput];
  
  const { data, error } = await supabase
    .from('sessions')
    .update({ image_input: updatedImages })
    .eq('id', sessionId)
    .select()
    .single();
  
  if (error) {
    throw new Error(`Failed to add image: ${error.message}`);
  }
  
  return data as Session;
}

/**
 * Update session status
 */
export async function updateSessionStatus(
  sessionId: string,
  status: SessionStatus,
  options?: {
    errorMessage?: string;
    jobId?: string;
    prompt?: string;
  },
): Promise<void> {
  const supabase = getSupabase();
  
  const updateData: Record<string, any> = { status };
  
  if (options?.errorMessage) {
    updateData.error_message = options.errorMessage;
  }
  if (options?.jobId) {
    updateData.job_id = options.jobId;
  }
  if (options?.prompt) {
    updateData.prompt = options.prompt;
  }
  
  const { error } = await supabase
    .from('sessions')
    .update(updateData)
    .eq('id', sessionId);
  
  if (error) {
    throw new Error(`Failed to update session: ${error.message}`);
  }
}

/**
 * Get session by ID
 */
export async function getSessionById(sessionId: string): Promise<Session | null> {
  const supabase = getSupabase();
  
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw error;
  }
  
  return data as Session;
}

/**
 * Get session by job ID
 */
export async function getSessionByJobId(jobId: string): Promise<Session | null> {
  const supabase = getSupabase();
  
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('job_id', jobId)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw error;
  }
  
  return data as Session;
}

/**
 * Cancel session
 */
export async function cancelSession(sessionId: string): Promise<void> {
  await updateSessionStatus(sessionId, 'cancelled');
}
