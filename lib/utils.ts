// Pure utility functions with no dependencies - safe to import in tests

export function guessContentType(filename: string): string | undefined {
  const ext = filename.toLowerCase().split('.').pop();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    default:
      return undefined;
  }
}

export function buildJobObjectPath(jobId: string, filename: string): string {
  // Remove leading slashes and path traversal attempts
  let cleanFilename = filename.replace(/^\/+/, '');
  
  // Remove path traversal attempts (../, ..\ and encoded versions)
  cleanFilename = cleanFilename.replace(/\.\.[\/\\]/g, '');
  cleanFilename = cleanFilename.replace(/%2e%2e[\/\\]/gi, '');
  cleanFilename = cleanFilename.replace(/\.\.%2f/gi, '');
  cleanFilename = cleanFilename.replace(/\.\.%5c/gi, '');
  
  // Use only the basename to prevent any path manipulation
  const parts = cleanFilename.split(/[\/\\]/);
  const safeFilename = parts[parts.length - 1] || 'file';
  
  // Sanitize job ID as well
  const safeJobId = jobId.replace(/[^a-zA-Z0-9_-]/g, '');
  
  return `jobs/${safeJobId}/${safeFilename}`;
}
