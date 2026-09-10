import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { withSandbox } from '../../../tests/support/sandbox.js';
import { writeTree } from '../../../tests/support/media-tree.js';
import { openDatabase } from '../../db/connection.js';
import { folderSnapshot, restoreSnapshot } from '../../db/queries.js';
import { loadEnv } from '../../config/env.js';
import { settingsSchema } from '../../config/settings.js';
import { detectLibraries, scanLibrary } from '../scanner/scanner.js';
import { ScannerClient } from '../scanner/client.js';
import { sidecarSchema } from '../sidecar/format.js';
import { writeSidecar } from '../sidecar/sidecar.js';
import { ProviderHttp } from '../providers/http.js';
import { Providers } from '../providers/providers.js';
import { TvdbClient } from '../providers/tvdb.js';
import { TmdbClient } from '../providers/tmdb.js';
import type { Metadata } from '../providers/normalized.js';
import { detail, episodes, thumbnails, mutateItem, deleteLibrary } from './items.js';

const settings = settingsSchema.parse({});
async function fixture(box: { media: string; config: string }) {
  await writeTree(box.media, {
    'TV/Show/Show.S01E01.mkv': 'first video', 'TV/Show/Show.S01E01.alternate.mp4': 'alternate video', 'TV/Show/unknown.mkv': 'mapped video',
    'TV/Show/tvshow.nfo': '<tvshow><title>Keep this NFO</title></tvshow>', 'TV/Show/poster.jpg': 'poster', 'TV/Show/season-specials-poster.jpg': 'specials poster',
    'TV/Show 2/escape.mkv': 'sibling video', 'Movies/Movie/Movie.mkv': 'movie',
  });
  const db = await openDatabase(box.config), folder = join(box.media, 'TV/Show');
  await detectLibraries(db, box.media);
  const snapshot = sidecarSchema.parse({ version: 2, binding: { provider: 'tmdb', external_id: '1', kind: 'series', title: 'Show', source_locked: true },
    custom_tags: ['Favorite'], overrides: [{ scope: 'series', field: 'plot', value: 'Custom plot' }],
    artwork_selections: [{ slot: 'season-01-poster', url: 'https://example.com/season.jpg' }, { slot: 'episode-thumb-22', url: 'https://image.tmdb.org/t/p/original/variant.jpg' }],
    episode_file_overrides: [{ file_path: 'unknown.mkv', season: 1, episode: 2, external_id: '22' }],
  });
  restoreSnapshot(db, folder, snapshot); await writeSidecar(folder, snapshot); await scanLibrary(db, box.media, 'TV'); await scanLibrary(db, box.media, 'Movies');
  const data: Metadata = { provider: 'tmdb', kind: 'series', id: '1', title: 'Show', year: 2020, plot: 'Plot', image: null, original_title: 'Show', sort_title: 'Show', tagline: '', runtime: 30, aired: null, genres: ['Drama'], studios: [], rating: null, content_rating: '', status: '', ids: { tmdb: '1' }, cast: [], artwork: [], seasons: [],
    episodes: [1, 2, 3].map(number => ({ id: String(number * 11), season: 1, episode: number, title: `Episode ${number}`, plot: '', aired: null, runtime: 30, image: `https://example.com/episode-${number}.jpg` })),
  };
  const http = new ProviderHttp(db), providers = new Providers(new TvdbClient(http, ''), new TmdbClient(http, ''));
  vi.spyOn(providers, 'details').mockImplementation(async () => structuredClone(data));
  vi.spyOn(providers.tmdb, 'keywords').mockResolvedValue(['Drama', 'space']);
  vi.spyOn(providers.tmdb, 'episodeImages').mockResolvedValue([{ provider: 'tmdb', id: 'variant', slot: 'thumb', season: null, url: 'https://image.tmdb.org/t/p/original/variant.jpg', thumb: 'https://image.tmdb.org/t/p/original/variant.jpg', language: 'en', score: 8, width: 1920, height: 1080 }]);
  return { db, folder, snapshot, providers };
}

test('items detail reads root-video matches, tags and independent poster progress without rewriting data', async () => withSandbox(async box => {
  const { db, folder, providers } = await fixture(box);
  try {
    const sidecar = join(folder, '.plex-nfo-builder.json'), before = await readFile(sidecar, 'utf8'), modified = (await stat(sidecar)).mtimeMs;
    const changes = db.prepare('SELECT total_changes() AS count').get();
    const result = await detail(db, box.media, settings, providers, folder);
    expect(result.provider_episode_count).toBe(2); expect(result.provider_used).toBe('tmdb');
    expect(result.tags).toEqual({ tvdb: [], tmdb: ['Drama', 'space'], custom: ['Favorite'] });
    expect(result.overrides.series?.plot).toBe('Custom plot'); expect(result.binding?.source_locked).toBe(true);
    expect(result.season_poster_progress).toMatchObject({ state: 'selected', required_seasons: [1], missing_seasons: [] });
    expect(result.artwork_files).toContain(join(folder, 'poster.jpg'));
    expect(result.artwork_files).toContain(join(folder, 'season-specials-poster.jpg'));
    expect(await readFile(sidecar, 'utf8')).toBe(before); expect((await stat(sidecar)).mtimeMs).toBe(modified);
    expect(db.prepare('SELECT total_changes() AS count').get()).toEqual(changes);
    expect(await readFile(join(folder, 'tvshow.nfo'), 'utf8')).toBe('<tvshow><title>Keep this NFO</title></tvshow>');
  } finally { db.close(); }
}));

test('items episode listing and thumbnail candidates retain the saved file identity and still choice', async () => withSandbox(async box => {
  const { db, folder, providers } = await fixture(box);
  try {
    const result = await episodes(db, box.media, settings, providers, folder);
    expect(result.locals.find(row => row.file_name === 'unknown.mkv')).toMatchObject({ unparsed: true, has_file_override: true, matched_episode_id: '22', matched_title: 'Episode 2' });
    const thumbs = await thumbnails(db, box.media, settings, providers, { path: folder, season: 1, episode: 2 });
    expect(thumbs.external_id).toBe('22'); expect(thumbs.current_selection).toBe('https://image.tmdb.org/t/p/original/variant.jpg');
    expect(thumbs.candidates.find(row => row.selected)).toMatchObject({ thumb: 'https://image.tmdb.org/t/p/w300/variant.jpg', width: 1920 });
    expect(thumbs.candidates.some(row => row.is_default && row.url === 'https://example.com/episode-2.jpg')).toBe(true);
  } finally { db.close(); }
}));

test('items mutation accepts relative and absolute media paths, rejects siblings, and mirrors overrides and tags', async () => withSandbox(async box => {
  const { db, folder, providers } = await fixture(box);
  try {
    await mutateItem(db, box.media, { op: 'file-override', request: { folder_path: folder, file_path: 'Show.S01E01.mkv', external_id: '33' } });
    await mutateItem(db, box.media, { op: 'file-override', request: { folder_path: folder, file_path: join(folder, 'unknown.mkv'), season: 1, episode: 2, external_id: '22' } });
    const before = await readFile(join(folder, '.plex-nfo-builder.json'), 'utf8');
    await expect(mutateItem(db, box.media, { op: 'file-override', request: { folder_path: folder, file_path: join(box.media, 'TV/Show 2/escape.mkv'), season: 1, episode: 1 } })).rejects.toThrow();
    expect(await readFile(join(folder, '.plex-nfo-builder.json'), 'utf8')).toBe(before);
    expect((await episodes(db, box.media, settings, providers, folder)).locals.find(row => row.file_name === 'Show.S01E01.mkv')?.matched_episode_id).toBe('33');
    await mutateItem(db, box.media, { op: 'episode-override', request: { folder_path: folder, season: 1, episode: 1, tvdb_episode_id: '22' } });
    await mutateItem(db, box.media, { op: 'tag-add', request: { folder_path: folder, tag: 'favorite' } });
    expect(folderSnapshot(db, folder).custom_tags).toEqual(['favorite']);
    await mutateItem(db, box.media, { op: 'tag-delete', request: { folder_path: folder, tag: 'FAVORITE' } });
    const snapshot = folderSnapshot(db, folder), saved = JSON.parse(await readFile(join(folder, '.plex-nfo-builder.json'), 'utf8'));
    expect(saved).toEqual(snapshot); expect(saved.custom_tags).toEqual([]); expect(saved.episode_overrides[0].tvdb_episode_id).toBe('22');
    expect(saved.episode_file_overrides.map((row: { file_path: string }) => row.file_path)).toEqual(expect.arrayContaining(['Show.S01E01.mkv', 'unknown.mkv']));
  } finally { db.close(); }
}));

test('items library deletion clears related database rows while preserving media and sidecars', async () => withSandbox(async box => {
  const { db, folder } = await fixture(box);
  try {
    db.prepare('INSERT INTO active_artwork VALUES (?,?,?,?)').run(folder, 'poster', join(folder, 'poster.jpg'), 1);
    db.prepare('INSERT INTO custom_artwork VALUES (?,?,?,?,?,?,?,?,?)').run('custom', folder, 'poster', 'url', 'https://example.com/art.jpg', null, null, null, 1);
    db.prepare('INSERT INTO watcher_review VALUES (?,?,?,?,?,?,?,?)').run(folder, 'TV', 'series', 'error', 'retry', 1, null, 1);
    db.prepare('INSERT INTO schedules(id,library,cron,action,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('schedule', 'TV', '* * * * *', 'scan_only', 1, 1);
    const sidecar = await readFile(join(folder, '.plex-nfo-builder.json'), 'utf8');
    expect(await deleteLibrary(db, box.media, 'TV')).toMatchObject({ ok: true, items: 2, bindings: 1 });
    for (const table of ['bindings', 'nfo_overrides', 'artwork_selections', 'active_artwork', 'custom_artwork', 'episode_overrides', 'episode_file_overrides', 'custom_tags', 'watcher_review', 'schedules']) expect(db.prepare(`SELECT * FROM ${table}`).all(), table).toEqual([]);
    expect(db.prepare('SELECT library FROM item_state').all()).toEqual([{ library: 'Movies' }]);
    expect(await readFile(join(folder, 'Show.S01E01.mkv'), 'utf8')).toBe('first video');
    expect(await readFile(join(folder, '.plex-nfo-builder.json'), 'utf8')).toBe(sidecar);
  } finally { db.close(); }
}));

test('items poster-selection filters are independent from NFO status and exclude movies', async () => withSandbox(async box => {
  const { db } = await fixture(box);
  await writeTree(box.media, { 'TV/Needs/Needs.S01E01.mkv': '', 'TV/Needs/tvshow.nfo': '<!-- plex-nfo-builder --><tvshow/>', 'TV/Needs/Needs.S01E01.nfo': '<!-- plex-nfo-builder --><episodedetails/>' });
  await scanLibrary(db, box.media, 'TV'); db.close();
  const scanner = new ScannerClient(loadEnv({ CONFIG_DIR: box.config, MEDIA_ROOT: box.media }), () => settings);
  try {
    const selected = await scanner.items({ poster_selection: 'selected' }); expect(selected.map(row => row.folder_path)).toEqual([join(box.media, 'TV/Show')]);
    expect(await scanner.items({ poster_selection: 'selected', status: 'complete' })).toEqual([]);
    const needs = await scanner.items({ poster_selection: 'needs_selection', status: 'complete' }); expect(needs.map(row => row.folder_path)).toEqual([join(box.media, 'TV/Needs')]);
    expect((await scanner.items({ library: 'Movies', poster_selection: 'all' }))[0]?.season_poster_progress?.state).toBe('not_applicable');
  } finally { await scanner.close(); }
}));
