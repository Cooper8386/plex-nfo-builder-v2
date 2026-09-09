import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

const digest = (value: string) => createHash('sha256').update(value).digest();
const docs = new Set(['/openapi.json', '/docs', '/docs/oauth2-redirect', '/redoc']);

export function installAuth(app: FastifyInstance, token?: string) {
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'OPTIONS') return;
    const url = new URL(request.url, 'http://localhost');
    const path = decodeURIComponent(url.pathname).replace(/\/+$/, '') || '/';
    if (path !== '/api' && !path.startsWith('/api/') && !docs.has(path)) return;
    if (!token) return reply.code(503).send({ detail: 'Server has no API_TOKEN configured' });
    const header = request.headers['x-api-token'];
    const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.authorization || '')?.[1];
    const supplied = (Array.isArray(header) ? header[0] : header) || bearer || url.searchParams.get('api_token') || '';
    if (!timingSafeEqual(digest(token), digest(supplied))) {
      return reply.code(401).send({ detail: 'Invalid or missing API token' });
    }
  });
}

export function safeUrl(raw: string) {
  // Access logs never need credentials or arbitrary query values.
  return raw.split('?')[0];
}
