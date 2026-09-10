import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { loadEnv } from '../../config/env.js';
import { settingsSchema } from '../../config/settings.js';
import { openDatabase } from '../../db/connection.js';
import { restoreSnapshot } from '../../db/queries.js';
import { providerDouble, withSandbox } from '../../../tests/support/index.js';
import { writeTree } from '../../../tests/support/media-tree.js';
import { workerModule } from '../fs/off-loop.js';
import { detectLibraries, scanLibrary } from '../scanner/scanner.js';
import { sidecarSchema } from '../sidecar/format.js';
import { writeSidecar } from '../sidecar/sidecar.js';
import { BuilderClient } from './client.js';

test('builder bulk queues real builds with two workers and serializes repeat builds of the same folder', async () => withSandbox(async box => {
  const responses: Record<string, unknown> = {};
  const folders = Array.from({ length: 20 }, (_, index) => join(box.media, 'TV', `Show ${index + 1}`));
  const tree: Record<string, string> = {};
  for (let id = 1; id <= folders.length; id++) {
    tree[`TV/Show ${id}/Show.S01E01.mkv`] = 'video';
    responses[`GET /3/tv/${id}`] = { id, name: `Show ${id}`, seasons: [{ id: id * 10, season_number: 1 }], credits: { cast: [] } };
    responses[`GET /3/tv/${id}/images`] = { posters: [{ file_path: `/poster-${id}.jpg`, iso_639_1: 'en', vote_average: 5 }] };
    responses[`GET /3/tv/${id}/season/1`] = { id: id * 10, name: 'Season One', episodes: [{ id: id * 100, season_number: 1, episode_number: 1, name: `Episode ${id}` }] };
    responses[`GET /3/tv/${id}/season/1/images`] = { posters: [] };
  }
  await writeTree(box.media, tree);
  const db = await openDatabase(box.config);
  try {
    await detectLibraries(db, box.media);
    for (let index = 0; index < folders.length; index++) {
      const snapshot = sidecarSchema.parse({ version: 2, binding: { kind: 'series', provider: 'tmdb', external_id: String(index + 1), title: `Show ${index + 1}` } });
      restoreSnapshot(db, folders[index]!, snapshot);
      await writeSidecar(folders[index]!, snapshot);
    }
    await scanLibrary(db, box.media, 'TV');
  } finally { db.close(); }
  const provider = await providerDouble('tmdb', responses);
  provider.setDelay(20);
  const env = loadEnv({ MEDIA_ROOT: box.media, CONFIG_DIR: box.config, TMDB_API_KEY: provider.url });
  const settings = settingsSchema.parse({ fanart_enabled: false });
  const client = new BuilderClient(env, () => settings, workerModule('../../../tests/support/build-worker.js', import.meta.url), 2);
  try {
    const bulk = await client.bulk({ library: 'TV' });
    expect(bulk.queued).toBe(20);
    await expect.poll(async () => (await client.queue.list()).filter(job => job.status === 'completed').length, { timeout: 20000 }).toBe(20);
    expect(provider.requests).toHaveLength(80);
    expect(provider.peakInFlight).toBeLessThanOrEqual(2);
    expect(provider.peakInFlight).toBeGreaterThan(1);
    expect((await client.bulk({library:'TV',only_unbuilt:true,force:true})).queued).toBe(0);
    for (const folder of folders) {
      expect(await readFile(join(folder, 'tvshow.nfo'), 'utf8')).toContain('<tvshow>');
      expect(await readFile(join(folder, 'Show.S01E01.nfo'), 'utf8')).toContain('<episodedetails>');
      expect(await readFile(join(folder, 'poster.jpg'), 'utf8')).toContain('https://image.tmdb.org/');
    }
    const repeated = await Promise.all(Array.from({ length: 3 }, () => client.build({ folder_path: folders[0]!, force: true })));
    await expect.poll(async () => (await client.queue.list()).filter(job => job.status === 'completed').length, { timeout: 10000 }).toBe(23);
    const jobs = (await client.queue.list()).filter(job => repeated.some(result => result.job === job.id)).sort((a, b) => a.started_at! - b.started_at!);
    expect(jobs).toHaveLength(3);
    for (let index = 1; index < jobs.length; index++) expect(jobs[index]!.started_at!).toBeGreaterThanOrEqual(jobs[index - 1]!.finished_at!);
    expect(JSON.stringify(jobs)).not.toContain(provider.url);
    expect(client.queue.lastError).toBeNull();
  } finally { await client.close(); await provider.close(); }
}), 35000);
