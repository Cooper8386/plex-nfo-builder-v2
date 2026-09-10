import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { withSandbox } from '../../../tests/support/sandbox.js';
import { writeTree } from '../../../tests/support/media-tree.js';
import { openDatabase } from '../../db/connection.js';
import { restoreSnapshot } from '../../db/queries.js';
import { loadEnv } from '../../config/env.js';
import { settingsSchema } from '../../config/settings.js';
import { detectLibraries } from '../scanner/scanner.js';
import { classifyStatus } from '../scanner/status.js';
import { sidecarSchema } from '../sidecar/format.js';
import { writeSidecar } from '../sidecar/sidecar.js';
import { saveArtwork } from '../artwork/download.js';
import { buildItem } from './builder.js';

test('root-video builder leaves readable tvshow.nfo and poster with complete episode coverage', async () => withSandbox(async box => {
  await writeTree(box.media, { 'TV/Anime/Anime.S01E01.mkv': 'video 1', 'TV/Anime/Anime.S01E02.mkv': 'video 2' });
  const folder = join(box.media, 'TV/Anime'), db = await openDatabase(box.config);
  try {
    await detectLibraries(db, box.media);
    const snapshot = sidecarSchema.parse({ version: 2, binding: { provider: 'tmdb', external_id: '1', kind: 'series' } });
    restoreSnapshot(db, folder, snapshot); await writeSidecar(folder, snapshot);
    const result = await buildItem(db, loadEnv({ MEDIA_ROOT: box.media, CONFIG_DIR: box.config }), settingsSchema.parse({ tmdb_api_key: 'fixture', fanart_enabled: false }), { folder_path: folder }, {
      download: (url, path) => saveArtwork(path, Buffer.from(url)),
      send: async value => {
        const path = new URL(value).pathname;
        const responses: Record<string, unknown> = {
          '/3/tv/1': { id: 1, name: 'Anime', seasons: [{ id: 10, season_number: 1 }], credits: { cast: [] } },
          '/3/tv/1/images': { posters: [{ file_path: '/anime.jpg', iso_639_1: 'en' }] },
          '/3/tv/1/season/1': { id: 10, name: 'One', episodes: [1, 2].map(episode => ({ id: 100 + episode, season_number: 1, episode_number: episode, name: `Episode ${episode}` })) },
          '/3/tv/1/season/1/images': { posters: [{ file_path: '/do-not-select-season.jpg' }] },
        };
        if (!(path in responses)) throw new Error(`Unexpected fixture request: ${path}`);
        return { status: 200, headers: {}, body: Buffer.from(JSON.stringify(responses[path])) };
      },
    });
    expect(result.status).toBe('complete');
    expect(await readFile(join(folder, 'tvshow.nfo'), 'utf8')).toContain('<tvshow>');
    expect(await readFile(join(folder, 'poster.jpg'), 'utf8')).toBe('https://image.tmdb.org/t/p/original/anime.jpg');
    expect(await classifyStatus(folder, 'series')).toMatchObject({ status: 'complete', missing: [], foreign: [], orphan_count: 0 });
    expect(await readFile(join(folder, 'Anime.S01E02.mkv'), 'utf8')).toBe('video 2');
    expect((await readdir(folder)).some(name => /season.*poster/i.test(name))).toBe(false);
  } finally { db.close(); }
}));
