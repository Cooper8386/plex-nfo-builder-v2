import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { withSandbox } from '../../../tests/support/sandbox.js';
import { openDatabase } from '../../db/connection.js';
import { loadEnv } from '../../config/env.js';
import { settingsSchema } from '../../config/settings.js';
import type { Transport } from '../providers/http.js';
import { plexRequest } from './plex.js';

test('plex API sections distinguishes configuration, initialization and upstream errors from valid empty libraries', async () => withSandbox(async box => {
  const db = await openDatabase(box.config), env = loadEnv({ MEDIA_ROOT: box.media, CONFIG_DIR: box.config });
  const configured = settingsSchema.parse({ plex_url: 'https://plex.example.com', plex_token: 'token' });
  const send = vi.fn<Transport>(async () => ({ status: 200, headers: {}, body: Buffer.from('{"MediaContainer":{"Directory":[]}}') }));
  const testing = { send, wait: async () => {} };
  try {
    await expect(plexRequest(db, env, settingsSchema.parse({}), { op: 'sections' }, testing)).rejects.toMatchObject({ statusCode: 400 });
    await expect(plexRequest(db, env, { ...configured, plex_url: 'invalid' }, { op: 'sections' }, testing)).rejects.toMatchObject({ statusCode: 500 });
    expect(await plexRequest(db, env, configured, { op: 'sections' }, testing)).toEqual({ sections: [] });
    send.mockResolvedValue({ status: 503, headers: {}, body: Buffer.from('{}') });
    await expect(plexRequest(db, env, configured, { op: 'sections' }, testing)).rejects.toMatchObject({ statusCode: 502 });
    expect(await plexRequest(db, env, configured, { op: 'test' }, testing)).toMatchObject({ ok: false, error: 'Provider returned HTTP 503' });
    expect(await plexRequest(db, env, settingsSchema.parse({}), { op: 'test' }, testing)).toMatchObject({ ok: false, error: expect.stringContaining('not configured') });
  } finally { db.close(); }
}));

test('plex API test returns identity and legacy section keys; refresh translates paths and refreshes matching metadata', async () => withSandbox(async box => {
  const folder = join(box.media, 'TV', 'Show'); await mkdir(folder, { recursive: true });
  const db = await openDatabase(box.config), env = loadEnv({ MEDIA_ROOT: box.media, CONFIG_DIR: box.config });
  const settings = settingsSchema.parse({ plex_url: 'https://plex.example.com', plex_token: 'token', plex_path_mappings: [{ from: box.media, to: '/wrong' }, { from: join(box.media, 'TV'), to: '/plex/tv' }] });
  const requests: string[] = [], wait = vi.fn(async () => {});
  const send: Transport = async (value, options) => {
    const url = new URL(value); requests.push(`${options.method ?? 'GET'} ${url.pathname}`);
    expect(options.headers?.['X-Plex-Token']).toBe('token');
    let data: unknown = {};
    if (url.pathname === '/identity') data = { MediaContainer: { machineIdentifier: 'server', version: '1', friendlyName: 'Plex' } };
    else if (url.pathname === '/library/sections') data = { MediaContainer: { Directory: [{ key: '7', title: 'TV', type: 'show', Location: [{ path: '/plex/tv' }] }] } };
    else if (url.pathname === '/library/sections/7/refresh') expect(url.searchParams.get('path')).toBe('/plex/tv/Show');
    else if (url.pathname === '/library/sections/7/all') data = { MediaContainer: { Metadata: [{ ratingKey: '42', title: 'Show', Location: [{ path: '/plex/tv/Show' }] }] } };
    return { status: 200, headers: {}, body: Buffer.from(JSON.stringify(data)) };
  };
  try {
    expect(await plexRequest(db, env, settings, { op: 'test' }, { send })).toEqual({ ok: true, identity: { machine_identifier: 'server', version: '1', friendly_name: 'Plex' }, sections: [{ id: '7', key: '7', title: 'TV', type: 'show', locations: ['/plex/tv'] }] });
    expect(await plexRequest(db, env, settings, { op: 'refresh', path: folder, delay_seconds: 900 }, { send, wait })).toMatchObject({ requested_local_path: folder, translated_path: '/plex/tv/Show', section_id: '7', section_title: 'TV', rating_key: '42', item_title: 'Show', strategy: 'metadata-refresh', refreshed: true, error: null });
    expect(wait).toHaveBeenCalledWith(600000);
    expect(requests).toContain('PUT /library/metadata/42/refresh');
  } finally { db.close(); }
}));

test('plex API refresh uses episode-parent fallback and reports partial-only or failed requests without throwing', async () => withSandbox(async box => {
  const folder = join(box.media, 'Show'); await mkdir(folder);
  const db = await openDatabase(box.config), env = loadEnv({ MEDIA_ROOT: box.media, CONFIG_DIR: box.config });
  const settings = settingsSchema.parse({ plex_url: 'https://plex.example.com', plex_token: 'token', plex_path_mappings: [{ from: box.media, to: '/plex' }] });
  let fallback = true, offline = false;
  const send: Transport = async value => {
    if (offline) throw new Error('Offline');
    const url = new URL(value);
    const data = url.pathname === '/library/sections' ? { MediaContainer: { Directory: [{ key: '1', title: 'TV', type: 'show', Location: [{ path: '/plex' }] }] } }
      : url.searchParams.get('type') === '4' && fallback ? { MediaContainer: { Metadata: [{ grandparentRatingKey: '99', grandparentTitle: 'Recovered Show', Media: [{ Part: [{ file: '/plex/Show/Season 01/S01E01.mkv' }] }] }] } } : {};
    return { status: 200, headers: {}, body: Buffer.from(JSON.stringify(data)) };
  };
  const wait = vi.fn(async () => {});
  try {
    expect(await plexRequest(db, env, settings, { op: 'refresh', path: folder, delay_seconds: -9 }, { send, wait })).toMatchObject({ strategy: 'metadata-refresh', rating_key: '99', item_title: 'Recovered Show', refreshed: true });
    expect(wait).not.toHaveBeenCalled();
    fallback = false;
    expect(await plexRequest(db, env, settings, { op: 'refresh', path: folder }, { send, wait })).toMatchObject({ strategy: 'partial-scan-only', item_count: 0, refreshed: true, error: expect.stringContaining('no item') });
    offline = true;
    expect(await plexRequest(db, env, settings, { op: 'refresh', path: folder }, { send, wait })).toMatchObject({ refreshed: false, error: 'Offline' });
    await expect(plexRequest(db, env, settings, { op: 'refresh', path: ' ' }, { send, wait })).rejects.toMatchObject({ statusCode: 400 });
    await expect(plexRequest(db, env, settings, { op: 'refresh', path: box.config }, { send, wait })).rejects.toThrow('Path outside MEDIA_ROOT');
  } finally { db.close(); }
}));
