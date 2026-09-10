import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { withSandbox } from '../../../tests/support/sandbox.js';
import { writeTree } from '../../../tests/support/media-tree.js';
import { openDatabase } from '../../db/connection.js';
import { restoreSnapshot } from '../../db/queries.js';
import { loadEnv } from '../../config/env.js';
import { settingsSchema } from '../../config/settings.js';
import { detectLibraries } from '../scanner/scanner.js';
import { sidecarSchema } from '../sidecar/format.js';
import { writeSidecar } from '../sidecar/sidecar.js';
import { saveArtwork } from '../artwork/download.js';
import type { Transport } from '../providers/http.js';
import { buildItem } from './builder.js';

const settings = settingsSchema.parse({ tmdb_api_key: 'fixture', fanart_enabled: false });
const download = (url: string, path: string) => saveArtwork(path, Buffer.from(url));
function fixture(withPoster = true): Transport {
  return async value => {
    const path = new URL(value).pathname;
    let payload: unknown;
    if (path === '/3/tv/1') payload = { id: 1, name: 'Show', seasons: [{ id: 10, season_number: 1 }], credits: { cast: [{ id: 20, name: 'Actor', character: 'Lead', profile_path: '/actor.jpg', order: 0 }] } };
    else if (path === '/3/movie/2') payload = { id: 2, title: 'Movie', release_date: '2020-01-01', credits: { cast: [] } };
    else if (path === '/3/tv/1/season/1') payload = { id: 10, name: 'Season One', episodes: [1, 2].map(episode => ({ id: 100 + episode, season_number: 1, episode_number: episode, name: `Episode ${episode}`, still_path: `/episode-${episode}.jpg` })) };
    else if (path === '/3/tv/1/season/1/images') payload = { posters: [{ file_path: '/automatic-season.jpg', iso_639_1: 'en', vote_average: 10 }] };
    else if (path === '/3/tv/1/images' || path === '/3/movie/2/images') payload = { posters: withPoster ? [{ file_path: '/poster.jpg', iso_639_1: 'en', vote_average: 8 }] : [] };
    else throw new Error(`Unexpected fixture request: ${path}`);
    return { status: 200, headers: {}, body: Buffer.from(JSON.stringify(payload)) };
  };
}

test('builder builds a season layout with the saved manual poster, actors and refreshed item state', async () => withSandbox(async box => {
  await writeTree(box.media, { 'TV/Show/Season 01/Show.S01E01.mkv': 'video 1', 'TV/Show/Season 01/Show.S01E02.mkv': 'video 2', 'TV/Show/Season 01/mystery.mkv':'mapped video' });
  const folder = join(box.media, 'TV/Show'), db = await openDatabase(box.config);
  const snapshot = sidecarSchema.parse({ version: 2, binding: { provider: 'tmdb', external_id: '1', kind: 'series', title: 'Show' }, artwork_selections: [{ slot: 'season-01-poster', url: 'https://example.com/manual.jpg' }], episode_file_overrides:[{file_path:'Season 01/mystery.mkv',season:1,episode:2,external_id:null}] });
  try {
    await detectLibraries(db, box.media); restoreSnapshot(db, folder, snapshot); await writeSidecar(folder, snapshot);
    const result = await buildItem(db, loadEnv({ MEDIA_ROOT: box.media, CONFIG_DIR: box.config }), settings, { folder_path: folder }, { send: fixture(), download });
    expect(result.status).toBe('complete');
    expect(await readFile(join(folder, 'Season01-poster.jpg'), 'utf8')).toBe('https://example.com/manual.jpg');
    expect(await readFile(join(folder, 'Season 01/season.nfo'), 'utf8')).toContain('https://example.com/manual.jpg');
    expect(await readFile(join(folder, '.actors/Actor.jpg'), 'utf8')).toBe('https://image.tmdb.org/t/p/original/actor.jpg');
    expect(await readFile(join(folder, 'Season 01/Show.S01E02.nfo'), 'utf8')).toContain('<title>Episode 2</title>');
    expect(await readFile(join(folder, 'Season 01/mystery.nfo'), 'utf8')).toContain('<title>Episode 2</title>');
    expect(await readFile(join(folder, 'Season 01/mystery-thumb.jpg'), 'utf8')).toBe('https://image.tmdb.org/t/p/original/episode-2.jpg');
    expect(await readFile(join(folder, 'tvshow.nfo'), 'utf8')).toContain('<name>Actor</name>');
    const state = db.prepare('SELECT nfo_status,last_built,episode_count_tvdb FROM item_state WHERE folder_path=?').get(folder) as { nfo_status: string; last_built: number; episode_count_tvdb: number };
    expect(state).toMatchObject({ nfo_status: 'complete', episode_count_tvdb: 2 }); expect(state.last_built).toBeGreaterThan(0);
    expect(JSON.parse(await readFile(join(folder, '.plex-nfo-builder.json'), 'utf8')).artwork_selections).toEqual(snapshot.artwork_selections);
  } finally { db.close(); }
}));

test('builder writes movie stem NFOs and the empty-folder fallback', async () => withSandbox(async box => {
  await writeTree(box.media, { 'Movies/Movie/Movie (2020).mkv': 'movie', 'Movies/Empty/placeholder.txt': '' });
  const db = await openDatabase(box.config);
  try {
    await detectLibraries(db, box.media);
    for (const name of ['Movie', 'Empty']) {
      const folder = join(box.media, 'Movies', name), snapshot = sidecarSchema.parse({ version: 2, binding: { provider: 'tmdb', external_id: '2', kind: 'movie' } });
      restoreSnapshot(db, folder, snapshot); await writeSidecar(folder, snapshot);
      const result = await buildItem(db, loadEnv({ MEDIA_ROOT: box.media, CONFIG_DIR: box.config }), settings, { folder_path: folder, kind: 'movie' }, { send: fixture(), download });
      expect(result.status).toBe('complete');
      expect(await readFile(join(folder, name === 'Movie' ? 'Movie (2020).nfo' : 'movie.nfo'), 'utf8')).toContain('<movie>');
      expect(await readFile(join(folder, 'poster.jpg'), 'utf8')).toBe('https://image.tmdb.org/t/p/original/poster.jpg');
    }
  } finally { db.close(); }
}));

test('builder refuses unbound folders and missing posters before creating NFO output', async () => withSandbox(async box => {
  await writeTree(box.media, { 'TV/Unbound/Show.S01E01.mkv': 'video', 'TV/NoPoster/Show.S01E01.mkv': 'video' });
  const db = await openDatabase(box.config), env = loadEnv({ MEDIA_ROOT: box.media, CONFIG_DIR: box.config });
  try {
    await detectLibraries(db, box.media);
    const unbound = join(box.media, 'TV/Unbound'), send = vi.fn(fixture());
    await expect(buildItem(db, env, settings, { folder_path: unbound }, { send, download })).rejects.toThrow('Bind this item');
    expect(send).not.toHaveBeenCalled(); expect(await readdir(unbound)).toEqual(['Show.S01E01.mkv']);
    const folder = join(box.media, 'TV/NoPoster'), snapshot = sidecarSchema.parse({ version: 2, binding: { provider: 'tmdb', external_id: '1', kind: 'series' } });
    restoreSnapshot(db, folder, snapshot); await writeSidecar(folder, snapshot);
    await expect(buildItem(db, env, settings, { folder_path: folder }, { send: fixture(false), download })).rejects.toThrow('No poster available');
    expect((await readdir(folder)).filter(file => file.endsWith('.nfo') || file === 'poster.jpg')).toEqual([]);
  } finally { db.close(); }
}));

test('builder preserves foreign NFOs when overwrite_foreign_nfo is disabled', async () => withSandbox(async box => {
  const foreign = '<tvshow><title>Foreign metadata</title></tvshow>';
  await writeTree(box.media, { 'TV/Show/Show.S01E01.mkv': 'video', 'TV/Show/tvshow.nfo': foreign, 'TV/Show/Show.S01E01.nfo': '<episodedetails><title>Foreign episode</title></episodedetails>' });
  const folder = join(box.media, 'TV/Show'), db = await openDatabase(box.config), env = loadEnv({ MEDIA_ROOT: box.media, CONFIG_DIR: box.config });
  try {
    await detectLibraries(db, box.media);
    const snapshot = sidecarSchema.parse({ version: 2, binding: { provider: 'tmdb', external_id: '1', kind: 'series' } });
    restoreSnapshot(db, folder, snapshot); await writeSidecar(folder, snapshot);
    const result = await buildItem(db, env, { ...settings, overwrite_foreign_nfo: false }, { folder_path: folder }, { send: fixture(), download });
    expect(result.status).toBe('foreign');
    expect(await readFile(join(folder, 'tvshow.nfo'), 'utf8')).toBe(foreign);
    expect(await readFile(join(folder, 'Show.S01E01.nfo'), 'utf8')).toContain('<title>Foreign episode</title>');
    await buildItem(db, env, settings, { folder_path: folder }, { send: fixture(), download });
    expect(await readFile(join(folder, 'tvshow.nfo'), 'utf8')).toContain('<!-- plex-nfo-builder');
    expect(await readFile(join(folder, 'Show.S01E01.nfo'), 'utf8')).toContain('<title>Episode 1</title>');
  } finally { db.close(); }
}));

test('builder resolves IMDb using the effective TVDB source without switching provider on failure', async () => withSandbox(async box => {
  await writeTree(box.media, { 'TV/Show/Show.S01E01.mkv': 'video' });
  const folder = join(box.media, 'TV/Show'), db = await openDatabase(box.config), env = loadEnv({ MEDIA_ROOT: box.media, CONFIG_DIR: box.config });
  const calls: URL[] = [];
  const send: Transport = async value => {
    const url = new URL(value); calls.push(url);
    expect(url.hostname).toBe('api4.thetvdb.com');
    const responses: Record<string, unknown> = {
      '/v4/login': { data: { token: 'fixture' } },
      '/v4/search/remoteid/tt123': { data: [{ series: { id: 1, name: 'Show' } }] },
      '/v4/search/remoteid/tt404': { data: [] },
      '/v4/series/1/extended': { data: { id: 1, name: 'Show', characters: [], seasons: [] } },
      '/v4/series/1/episodes/default/eng': { data: { episodes: [{ id: 101, seasonNumber: 1, number: 1, name: 'TVDB Pilot' }] }, links: { next: null } },
    };
    if (!(url.pathname in responses)) throw new Error(`Unexpected fixture request: ${url.pathname}`);
    return { status: 200, headers: {}, body: Buffer.from(JSON.stringify(responses[url.pathname])) };
  };
  try {
    await detectLibraries(db, box.media);
    db.prepare("UPDATE libraries SET metadata_source='tvdb' WHERE name='TV'").run();
    const snapshot = sidecarSchema.parse({ version: 2, binding: { provider: 'imdb', external_id: 'tt123', kind: 'series' }, artwork_selections: [{ slot: 'poster', url: 'https://example.com/manual.jpg' }] });
    restoreSnapshot(db, folder, snapshot); await writeSidecar(folder, snapshot);
    const configured = settingsSchema.parse({ metadata_source: 'tmdb', tvdb_api_key: 'fixture', tmdb_api_key: 'fixture', fanart_enabled: false, tmdb_artwork_enabled: false });
    const result = await buildItem(db, env, configured, { folder_path: folder }, { send, download });
    expect(result.status).toBe('complete');
    const nfo = await readFile(join(folder, 'tvshow.nfo'), 'utf8');
    expect(nfo).toContain('<uniqueid type="tvdb" default="true">1</uniqueid>');
    expect(nfo).toContain('<uniqueid type="imdb">tt123</uniqueid>');
    expect(await readFile(join(folder, 'Show.S01E01.nfo'), 'utf8')).toContain('<title>TVDB Pilot</title>');
    const unresolved = { ...snapshot, binding: { ...snapshot.binding!, external_id: 'tt404' } };
    restoreSnapshot(db, folder, unresolved); await writeSidecar(folder, unresolved);
    await expect(buildItem(db, env, configured, { folder_path: folder }, { send, download })).rejects.toThrow('IMDb identity needs a resolvable provider record');
    expect(calls.some(url => url.pathname === '/v4/search/remoteid/tt404')).toBe(true);
    expect(calls.every(url => url.hostname === 'api4.thetvdb.com')).toBe(true);
  } finally { db.close(); }
}));
