import { Writable } from 'node:stream';
import { createRequire } from 'node:module';
import { expect, test } from 'vitest';
import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { startServer } from '../index.js';
import { withSandbox } from '../../tests/support/sandbox.js';

const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };

test.each(['/api/health', '/api', '/api/unknown', '/docs', '/docs/', '/docs/oauth2-redirect', '/redoc', '/openapi.json'])('auth fails closed on %s', async url => {
  const app = createApp({ env: loadEnv({}), logger: false });
  try {
    const response = await app.inject({ url });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ detail: 'Server has no API_TOKEN configured' });
    expect((await app.inject({ url, method: 'OPTIONS' })).statusCode).not.toBe(503);
  } finally { await app.close(); }
});

test('auth rejects bad credentials; accepts all transports with header precedence', async () => {
  const app = createApp({ env: loadEnv({ API_TOKEN: 'secret' }), logger: false });
  try {
    for (const headers of [{}, { 'x-api-token': 'bad' }]) expect((await app.inject({ url: '/api/health', headers })).statusCode).toBe(401);
    for (const request of [
      { url: '/api/health', headers: { 'x-api-token': 'secret' } },
      { url: '/api/health', headers: { authorization: 'Bearer secret' } },
      { url: '/api/health?api_token=secret' },
    ]) {
      const response = await app.inject(request);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ ok: true, version, metadata_source: 'tvdb', plex_configured: false });
    }
    expect((await app.inject({ url: '/api/health?api_token=secret', headers: { 'x-api-token': 'bad', authorization: 'Bearer secret' } })).statusCode).toBe(401);
    expect((await app.inject({ url: '/docs' })).statusCode).toBe(401);
  } finally { await app.close(); }
});

test('auth logs never expose tokens on success, denial, or missing routes', async () => {
  let logs = '';
  const stream = new Writable({ write(chunk, _encoding, done) { logs += chunk.toString(); done(); } });
  const app = createApp({ env: loadEnv({ API_TOKEN: 'sensitive-value' }), logger: { stream } });
  try {
    for (const url of ['/api/health', '/api/missing', '/missing']) {
      await app.inject({ url: `${url}?api_token=sensitive-value`, headers: { 'x-api-token': 'sensitive-value' } });
    }
    await app.inject({ url: '/api/health?api_token=wrong-sensitive-value' });
    expect(logs).toContain('/api/health');
    expect(logs).not.toContain('sensitive-value');
  } finally { await app.close(); }
});

test('auth CORS is off by default, allowlists origins and rejects untrusted hosts', async () => {
  const app = createApp({ env: loadEnv({ API_TOKEN: 'secret', TRUSTED_HOSTS: 'localhost', CORS_ALLOW_ORIGINS: 'https://allowed.example' }), logger: false });
  try {
    expect((await app.inject({ url: '/api/health', headers: { host: 'evil.example', 'x-api-token': 'secret' } })).statusCode).toBe(400);
    const allowed = await app.inject({ method: 'OPTIONS', url: '/api/health', headers: { origin: 'https://allowed.example', 'access-control-request-method': 'GET' } });
    expect(allowed.headers['access-control-allow-origin']).toBe('https://allowed.example');
    const denied = await app.inject({ method: 'OPTIONS', url: '/api/health', headers: { origin: 'https://denied.example', 'access-control-request-method': 'GET' } });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  } finally { await app.close(); }
  const defaultApp = createApp({ env: loadEnv({ API_TOKEN: 'secret' }), logger: false });
  try {
    expect((await defaultApp.inject({ url: '/api/health', headers: { origin: 'https://allowed.example', 'x-api-token': 'secret' } })).headers['access-control-allow-origin']).toBeUndefined();
  } finally { await defaultApp.close(); }
});

test('auth health responds on a real listener while startup remains unfinished', async () => withSandbox(async box => {
  let finish!: () => void;
  let began!: () => void;
  const entered = new Promise<void>(resolve => { began = resolve; });
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const app = await startServer(loadEnv({ API_TOKEN: 'secret', LISTEN_HOST: '127.0.0.1', LISTEN_PORT: '0', CONFIG_DIR: box.config, MEDIA_ROOT: `${box.root}/missing-share`, LOG_LEVEL: 'silent' }), async () => { began(); await pending; });
  try {
    await entered;
    const response = await fetch(`${app.listeningOrigin}/api/health`, { headers: { 'X-API-Token': 'secret' }, signal: AbortSignal.timeout(1000) });
    expect(response.status).toBe(200);
  } finally { finish(); await app.close(); }
}));
