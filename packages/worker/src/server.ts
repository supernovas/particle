import { createServer, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import type { WorkspacePayload } from './serialize.ts';

/**
 * The worker's local UI surface: workspace snapshot, an SSE tick per appended
 * batch, and message posting. Also serves packages/ui/dist when it exists, so
 * a built checkout is a complete product at one address.
 */

export interface ServerDeps {
  payload: () => WorkspacePayload;
  /** Append a message from the operator. Returns false for unknown projects. */
  postMessage: (projectId: string, body: string) => Promise<boolean>;
}

export interface UiServer {
  /** Notify connected clients that new events landed. */
  broadcast: () => void;
  close: () => void;
  port: number;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(data);
}

async function readBody(req: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export function startServer(deps: ServerDeps, port: number, distDir?: string): UiServer {
  const clients = new Set<ServerResponse>();
  const dist = distDir ? resolve(distDir) : undefined;

  const server = createServer((req, res) => {
    void handle();

    async function handle(): Promise<void> {
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/api/workspace') {
        sendJson(res, 200, deps.payload());
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        });
        res.write('event: hello\ndata: {}\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }

      const post = url.pathname.match(/^\/api\/projects\/([^/]+)\/messages$/);
      if (req.method === 'POST' && post) {
        try {
          const parsed = JSON.parse(await readBody(req)) as { body?: unknown };
          const body = typeof parsed.body === 'string' ? parsed.body.trim() : '';
          if (body === '') {
            sendJson(res, 400, { error: 'body must be a non-empty string' });
            return;
          }
          const ok = await deps.postMessage(decodeURIComponent(post[1]!), body);
          if (!ok) {
            sendJson(res, 404, { error: 'unknown project' });
            return;
          }
          sendJson(res, 202, { ok: true });
        } catch {
          sendJson(res, 400, { error: 'invalid JSON' });
        }
        return;
      }

      if (req.method === 'GET' && dist) {
        const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const path = normalize(join(dist, rel));
        if (path.startsWith(dist) && existsSync(path) && statSync(path).isFile()) {
          res.writeHead(200, {
            'content-type': MIME[extname(path)] ?? 'application/octet-stream',
          });
          res.end(readFileSync(path));
          return;
        }
        // SPA fallback for client-side routes.
        const index = join(dist, 'index.html');
        if (existsSync(index)) {
          res.writeHead(200, { 'content-type': MIME['.html']! });
          res.end(readFileSync(index));
          return;
        }
      }

      sendJson(res, 404, { error: 'not found' });
    }
  });

  server.on('error', (err) => {
    console.error(`ui server unavailable: ${(err as Error).message}`);
  });
  server.listen(port);
  return {
    broadcast() {
      for (const client of clients) client.write('event: append\ndata: {}\n\n');
    },
    close() {
      for (const client of clients) client.end();
      server.close();
    },
    port,
  };
}
