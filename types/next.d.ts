// Type shim for 'next' module when node_modules is not available
// This will be overridden by actual types when dependencies are installed

declare module 'next' {
  import type { IncomingHttpHeaders } from 'http';

  export interface NextApiRequest {
    query: { [key: string]: string | string[] };
    cookies: { [key: string]: string };
    body: any;
    method?: string;
    headers: IncomingHttpHeaders;
    url?: string;
  }

  export interface NextApiResponse<T = any> {
    status(statusCode: number): NextApiResponse<T>;
    json(body: T): void;
    send(body: any): void;
    redirect(url: string): NextApiResponse<T>;
    redirect(status: number, url: string): NextApiResponse<T>;
    setHeader(name: string, value: string | number | readonly string[]): void;
    end(): void;
  }
}
