import { utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { withSandbox } from '../../../tests/support/sandbox.js';
import { writeTree } from '../../../tests/support/media-tree.js';
import { createApp } from '../../app.js';
import { loadEnv } from '../../config/env.js';
import { settingsSchema } from '../../config/settings.js';
import { writeSidecar } from '../sidecar/sidecar.js';
import { sidecarSchema } from '../sidecar/format.js';

test('scanner detects libraries, preserves manual settings, recovers sidecars and keeps first-seen dates', async () => withSandbox(async box => {
  await writeTree(box.media, { 'TV/Show/Season 01/a.mkv': '', 'Movies/Film/Film.mkv': '', 'Mixed/Show/a.S01E01.mkv': '', 'Mixed/Film/Film.mp4': '' });
  const folder = join(box.media, 'TV/Show'), season = join(folder, 'Season 01');
  await writeSidecar(folder, sidecarSchema.parse({ version: 2, binding: { kind: 'series', provider: 'tvdb', external_id: '123', title: 'Recovered', source_locked: true } }));
  await utimes(folder, 1000, 1000); await utimes(season, 2000, 2000);
  let settings = settingsSchema.parse({ metadata_source: 'tvdb' });
  const app = createApp({ logger: false, env: loadEnv({ API_TOKEN: 'test', CONFIG_DIR: box.config, MEDIA_ROOT: box.media }), settings: () => settings });
  const headers = { 'x-api-token': 'test' };
  try {
    // All pools can open a fresh database concurrently.
    const [detected] = await Promise.all([app.scanner.detect(), app.scanner.libraries(), app.scanner.items()]);
    expect(Object.fromEntries(detected.map(l => [l.name, l.kind]))).toEqual({ TV: 'tv', Movies: 'movies', Mixed: 'mixed' });
    const updated = await app.inject({ method: 'POST', url: '/api/libraries/TV', headers, payload: { metadata_source: 'tmdb' } });
    expect(updated.statusCode).toBe(200);
    await app.scanner.detect();
    expect((await app.scanner.libraries()).find(l => l.name === 'TV')?.effective_metadata_source).toBe('tmdb');
    settings = { ...settings, metadata_source: 'tmdb' };
    expect((await app.scanner.libraries()).find(l => l.name === 'Movies')?.effective_metadata_source).toBe('tmdb');
    await app.scanner.scan('TV');
    let item = (await app.scanner.items())[0]!;
    expect(item.title).toBe('Recovered'); expect(item.external_id).toBe('123');
    expect(item.date_added).toBe(1000000); expect(item.date_updated).toBe(2000000);
    await utimes(folder, 3000, 3000); await utimes(season, 4000, 4000);
    await app.scanner.scan('TV'); item = (await app.scanner.items())[0]!;
    expect(item.date_added).toBe(1000000); expect(item.date_updated).toBe(4000000);
    await app.scanner.update('TV', { enabled: false });
    await app.scanner.detect(); expect(await app.scanner.scan('TV')).toBe(0);
    expect((await app.inject({ method: 'POST', url: '/api/libraries/TV', headers, payload: { metadata_source: 'imdb' } })).statusCode).toBe(422);
    expect((await app.inject({ url: `/api/items/nfo-explain?path=${encodeURIComponent(box.config)}`, headers })).statusCode).toBe(400);
  } finally { await app.close(); }
}));
