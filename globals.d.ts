// Global type declarations for development environment
// This file provides type definitions when node_modules is not available
// Vercel will use the actual installed packages

// Ensure process.env is available globally
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      TELEGRAM_BOT_TOKEN?: string;
      TG_WEBHOOK_SECRET?: string;
      REPLICATE_MODEL_VERSION?: string;
      NODE_ENV?: 'development' | 'production' | 'test';
      [key: string]: string | undefined;
    }

    interface Process {
      env: ProcessEnv;
    }
  }

  var process: NodeJS.Process;
}

export {};
