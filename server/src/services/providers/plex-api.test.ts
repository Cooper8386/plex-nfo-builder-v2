import { expect, test, vi } from 'vitest';
import { withSandbox } from '../../../tests/support/sandbox.js';
import { openDatabase } from '../../db/connection.js';
import { ProviderHttp, type HttpReply, type RequestOptions } from './http.js';
import { PlexClient } from './plex.js';

const reply = (body: unknown, status = 200): HttpReply => ({ status, headers: {}, body: Buffer.from(JSON.stringify(body)) });

test('plex API strict methods distinguish upstream failures from tolerant client fallbacks', async () => withSandbox(async box => {
  const db = await openDatabase(box.config);
  const send = vi.fn(async () => reply({}, 503));
  const plex = new PlexClient(new ProviderHttp(db, undefined, send, async () => {}), 'https://plex.example.com', 'token');
  try {
    await expect(plex.sectionsOrThrow()).rejects.toThrow('HTTP 503');
    await expect(plex.identityOrThrow()).rejects.toThrow('HTTP 503');
    expect(await plex.sections()).toEqual([]);
    expect(await plex.identity()).toBeNull();
    expect(await plex.refresh('/media/TV/Show')).toBe(false);
    send.mockRejectedValue(new Error('Connection unavailable'));
    await expect(plex.sectionsOrThrow()).rejects.toThrow('Connection unavailable');
    await expect(plex.identityOrThrow()).rejects.toThrow('Connection unavailable');
    expect(await plex.sections()).toEqual([]);
    expect(await plex.identity()).toBeNull();
  } finally { db.close(); }
}));

test('plex API strict methods retain valid empty sections, normalization and token headers', async () => withSandbox(async box => {
  const db = await openDatabase(box.config);
  const send = vi.fn(async (url: string, options: RequestOptions) => {
    expect(new URL(url).searchParams.has('X-Plex-Token')).toBe(false);
    expect(options.headers).toEqual({ 'X-Plex-Token': 'token', Accept: 'application/json' });
    return new URL(url).pathname === '/identity'
      ? reply({ MediaContainer: { machineIdentifier: 'server-id', version: '1.0', friendlyName: 'My Plex' } })
      : reply({ MediaContainer: { Directory: [] } });
  });
  const plex = new PlexClient(new ProviderHttp(db, undefined, send), 'https://plex.example.com', 'token');
  try {
    expect(await plex.sectionsOrThrow()).toEqual([]);
    expect(await plex.identityOrThrow()).toEqual({ machine_identifier: 'server-id', version: '1.0', friendly_name: 'My Plex' });
    send.mockResolvedValue(reply({ MediaContainer: { Directory: [{ key: '2', title: 'TV', type: 'show', Location: [{ path: '/plex/tv' }, { path: '/plex/anime' }] }] } }));
    expect(await plex.sectionsOrThrow()).toEqual([{ id: '2', title: 'TV', type: 'show', locations: ['/plex/tv', '/plex/anime'] }]);
    expect(await plex.sections()).toEqual(await plex.sectionsOrThrow());
    expect(db.prepare('SELECT * FROM provider_cache').all()).toEqual([]);
  } finally { db.close(); }
}));

test('plex API strict methods retain the real HTTP SSRF guard for private Plex URLs', async () => withSandbox(async box => {
  const db = await openDatabase(box.config);
  const plex = new PlexClient(new ProviderHttp(db, undefined, undefined, async () => {}), 'http://127.0.0.1:32400', 'token');
  try {
    await expect(plex.sectionsOrThrow()).rejects.toThrow('Unsafe URL address');
    await expect(plex.identityOrThrow()).rejects.toThrow('Unsafe URL address');
    expect(await plex.sections()).toEqual([]);
    expect(await plex.identity()).toBeNull();
  } finally { db.close(); }
}));
