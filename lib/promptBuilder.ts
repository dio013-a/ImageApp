/**
 * Build professional studio family portrait prompt for Replicate
 * 
 * Requirements:
 * - Neutral, respectful, realistic
 * - Cohesive lighting, camera angle, background
 * - No exaggeration, no glamour effects
 * - Preserve facial identity from all input photos
 * - Natural skin tones, age-appropriate appearance
 * - Studio photography look (soft lighting, sharp focus)
 */

export interface PromptOptions {
  imageCount: number;
  customInstructions?: string;
}

export function buildStudioPortraitPrompt(options: PromptOptions): string {
  const { imageCount, customInstructions } = options;
  
  // Base prompt components
  const components = [
    'Professional studio family portrait photograph',
    imageCount === 1 
      ? 'of one person'
      : `of ${imageCount} family members together`,
    'soft diffused studio lighting with natural skin tones',
    'neutral background with subtle gradient',
    'camera at eye level',
    'sharp focus on faces',
    'natural expressions and poses',
    'cohesive composition',
    'photorealistic quality',
    'high resolution professional photography',
  ];
  
  // Add custom instructions if provided
  if (customInstructions && customInstructions.trim()) {
    components.push(customInstructions.trim());
  }
  
  // Join with proper grammar
  const prompt = components.join(', ') + '.';
  
  return prompt;
}

/**
 * Validate prompt for safety (basic check)
 */
export function validatePrompt(prompt: string): { valid: boolean; reason?: string } {
  const lowerPrompt = prompt.toLowerCase();
  
  // Block list (basic safety)
  const blockedTerms = [
    'nude',
    'naked',
    'sexual',
    'explicit',
    'violent',
    'gore',
    'hate',
  ];
  
  for (const term of blockedTerms) {
    if (lowerPrompt.includes(term)) {
      return {
        valid: false,
        reason: `Prompt contains blocked term: ${term}`,
      };
    }
  }
  
  // Length check
  if (prompt.length > 1000) {
    return {
      valid: false,
      reason: 'Prompt too long (max 1000 characters)',
    };
  }
  
  return { valid: true };
}
