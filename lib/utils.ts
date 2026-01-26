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
  const cleanFilename = filename.replace(/^\/+/, '');
  return `jobs/${jobId}/${cleanFilename}`;
}
