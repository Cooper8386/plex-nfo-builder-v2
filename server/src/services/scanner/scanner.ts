import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type Database from 'better-sqlite3';
import type { Item, Library, LibraryKind, MetadataSource, NfoExplanation, UpdateLibraryRequest, ItemsQuery } from 'shared';
import { z } from 'zod';
import { openDatabase } from '../../db/connection.js';
import { getBinding } from '../../db/queries.js';
import { mediaPath } from '../../config/paths.js';
import { recoverSidecar } from '../sidecar/sidecar.js';
import { classifyStatus } from './status.js';
import { detectKind, mediaFolders } from './layout.js';

let db: Database.Database | undefined;
let config: string | undefined;
const updateSchema = z.object({ kind: z.enum(['tv', 'movies', 'mixed']).optional(), enabled: z.boolean().optional(), metadata_source: z.enum(['tvdb', 'tmdb']).nullable().optional() }).strict();
interface Input { configDir: string; mediaRoot: string; action: string; name?: string; path?: string; update?: UpdateLibraryRequest; query?: ItemsQuery }

export async function detectLibraries(database: Database.Database, mediaRoot: string): Promise<Library[]> {
  const entries = await readdir(mediaRoot, { withFileTypes: true });
  for (const entry of entries.filter(entry => entry.isDirectory())) {
    const folder = await mediaPath(mediaRoot, entry.name);
    const children = await readdir(folder, { withFileTypes: true });
    const kinds = new Set(await Promise.all(children.filter(child => child.isDirectory()).map(child => detectKind(join(folder, child.name)))));
    const kind: LibraryKind = kinds.size > 1 ? 'mixed' : kinds.has('series') ? 'tv' : 'movies';
    database.prepare(`INSERT INTO libraries(name,kind,detected_at) VALUES (?,?,?)
      ON CONFLICT(name) DO UPDATE SET detected_at=excluded.detected_at`).run(entry.name, kind, Date.now());
  }
  return database.prepare('SELECT * FROM libraries ORDER BY name').all() as Library[];
}

export async function scanLibrary(database: Database.Database, mediaRoot: string, name: string) {
  const library = database.prepare('SELECT * FROM libraries WHERE name=?').get(name) as Library | undefined;
  if (!library) throw new Error('Library not found');
  if (!library.enabled) return 0;
  if (basename(name) !== name || name === '..' || name === '.') throw new Error('Path outside MEDIA_ROOT');
  const libraryFolder = await mediaPath(mediaRoot, name);
  const entries = await readdir(libraryFolder, { withFileTypes: true });
  let count = 0;
  for (const entry of entries.filter(entry => entry.isDirectory())) {
    const folder = await mediaPath(mediaRoot, join(libraryFolder, entry.name));
    await recoverSidecar(database, folder);
    const binding = getBinding(database, folder);
    const kind = binding?.kind ?? (library.kind === 'tv' ? 'series' : library.kind === 'movies' ? 'movie' : await detectKind(folder));
    const explanation = await classifyStatus(folder, kind);
    const folders = await mediaFolders(folder);
    const timestamps = await Promise.all(folders.map(group => stat(group.path)));
    const title = binding?.title || entry.name;
    const sortOverride = database.prepare("SELECT value FROM nfo_overrides WHERE folder_path=? AND scope IN ('series','movie') AND field='sorttitle' LIMIT 1").get(folder) as { value: string } | undefined;
    database.prepare(`INSERT INTO item_state(folder_path,library,kind,title,year,external_id,provider,nfo_status,episode_count_local,
      season_count_local,last_scanned,sort_title,orphan_count,date_added,date_updated,poster_path)
      VALUES (@folder,@library,@kind,@title,@year,@external_id,@provider,@status,@videos,@seasons,@now,@sort,@orphans,@added,@updated,@poster)
      ON CONFLICT(folder_path) DO UPDATE SET kind=excluded.kind,title=excluded.title,year=excluded.year,external_id=excluded.external_id,
      provider=excluded.provider,nfo_status=excluded.nfo_status,episode_count_local=excluded.episode_count_local,
      season_count_local=excluded.season_count_local,last_scanned=excluded.last_scanned,sort_title=excluded.sort_title,
      orphan_count=excluded.orphan_count,date_updated=excluded.date_updated,poster_path=excluded.poster_path`).run({
      folder, library: name, kind, title, year: binding?.year ?? null, external_id: binding?.external_id ?? null,
      provider: binding?.provider ?? null, status: explanation.status, videos: explanation.video_count,
      seasons: folders.filter(group => group.season !== null).length, now: Date.now(), sort: sortOverride?.value ?? title.replace(/^(the|a|an)\s+/i, ''),
      orphans: explanation.orphan_count, added: timestamps[0]!.mtimeMs, updated: Math.max(...timestamps.map(value => value.mtimeMs)),
      poster: await stat(join(folder, 'poster.jpg')).then(value => value.isFile() ? join(folder, 'poster.jpg') : null).catch(() => null),
    });
    count++;
  }
  return count;
}

export async function handle(input: Input) {
  if (!db) { db = await openDatabase(input.configDir); config = input.configDir; }
  if (config !== input.configDir) throw new Error('Scanner worker owns one config directory');
  if (input.action === 'detect') return detectLibraries(db, input.mediaRoot);
  if (input.action === 'scan') return scanLibrary(db, input.mediaRoot, input.name!);
  if (input.action === 'libraries') return db.prepare('SELECT * FROM libraries ORDER BY name').all();
  if (input.action === 'update') {
    const update = updateSchema.parse(input.update);
    const database = db;
    return database.transaction(() => {
    const row = database.prepare('SELECT * FROM libraries WHERE name=?').get(input.name!) as Library | undefined;
    if (!row) throw new Error('Library not found');
    database.prepare('UPDATE libraries SET kind=?,enabled=?,metadata_source=? WHERE name=?').run(update.kind ?? row.kind,
      update.enabled === undefined ? row.enabled : Number(update.enabled), update.metadata_source === undefined ? row.metadata_source : update.metadata_source, input.name!);
    return database.prepare('SELECT * FROM libraries WHERE name=?').get(input.name!);
    }).immediate();
  }
  if (input.action === 'items') {
    const query = input.query ?? {};
    const rows = db.prepare('SELECT * FROM item_state WHERE (? IS NULL OR library=?) ORDER BY sort_title COLLATE NOCASE,folder_path').all(query.library ?? null, query.library ?? null) as Item[];
    const statuses = query.status?.split(',').filter(Boolean);
    return rows.filter(row => (!statuses?.length || statuses.includes(row.nfo_status)) &&
      (!query.q || (row.title ?? '').toLowerCase().includes(query.q.toLowerCase())) && (!query.hide_organized || row.nfo_status !== 'complete'));
  }
  if (input.action === 'explain') {
    const folder = await mediaPath(input.mediaRoot, input.path!);
    const binding = getBinding(db, folder);
    const row = db.prepare('SELECT kind FROM item_state WHERE folder_path=?').get(folder) as { kind: 'series' | 'movie' } | undefined;
    return classifyStatus(folder, binding?.kind ?? row?.kind ?? await detectKind(folder));
  }
  throw new Error(`Unknown scanner action: ${input.action}`);
}

export type { Item, Library, MetadataSource, NfoExplanation };
