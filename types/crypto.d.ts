// Type shim for 'crypto' module when node_modules is not available
// This will be overridden by actual types when dependencies are installed

declare module 'crypto' {
  export function randomBytes(size: number): {
    toString(encoding: string): string;
  };
}
