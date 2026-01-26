export function assertEnv(key: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return trimmed;
}
