import type Database from 'better-sqlite3';
import { join, relative, sep } from 'node:path';
import { bindingSchema, sidecarSchema, type Binding, type Sidecar } from '../services/sidecar/format.js';

export function getBinding(db: Database.Database, folder: string): Binding | null {
  const row = db.prepare('SELECT kind, provider, external_id, title, year, language, source_locked, secondary_provider, secondary_external_id FROM bindings WHERE folder_path = ?').get(folder) as (Omit<Binding, 'source_locked'> & { source_locked: number }) | undefined;
  return row ? { ...row, source_locked: Boolean(row.source_locked) } : null;
}

export function putBinding(db: Database.Database, folder: string, input: Binding, automatic = false) {
  const binding = bindingSchema.parse(input);
  const now = Date.now();
  return db.prepare(`INSERT INTO bindings (folder_path,kind,provider,external_id,title,year,language,source_locked,secondary_provider,secondary_external_id,created_at,updated_at)
    VALUES (@folder,@kind,@provider,@external_id,@title,@year,@language,@source_locked,@secondary_provider,@secondary_external_id,@now,@now)
    ON CONFLICT(folder_path) DO UPDATE SET kind=excluded.kind,provider=excluded.provider,external_id=excluded.external_id,
    title=excluded.title,year=excluded.year,language=excluded.language,source_locked=excluded.source_locked,
    secondary_provider=excluded.secondary_provider,secondary_external_id=excluded.secondary_external_id,updated_at=excluded.updated_at
    WHERE @automatic = 0 OR bindings.source_locked = 0`).run({ ...binding, folder, source_locked: Number(binding.source_locked), now, automatic: Number(automatic) }).changes > 0;
}

export function folderSnapshot(db: Database.Database, folder: string): Sidecar {
  const files = db.prepare('SELECT file_path,season,episode,external_id FROM episode_file_overrides WHERE folder_path=?').all(folder) as Sidecar['episode_file_overrides'];
  return sidecarSchema.parse({
    version: 2, binding: getBinding(db, folder),
    overrides: db.prepare('SELECT scope,field,value FROM nfo_overrides WHERE folder_path=? ORDER BY scope,field').all(folder),
    artwork_selections: db.prepare('SELECT slot,url,language,score FROM artwork_selections WHERE folder_path=? ORDER BY slot').all(folder),
    episode_overrides: db.prepare('SELECT season,episode,tvdb_episode_id FROM episode_overrides WHERE folder_path=? ORDER BY season,episode').all(folder),
    episode_file_overrides: files.map(row => ({ ...row, file_path: relative(folder, row.file_path).split(sep).join('/') })),
    custom_tags: (db.prepare('SELECT tag FROM custom_tags WHERE folder_path=? ORDER BY tag').all(folder) as { tag: string }[]).map(row => row.tag),
  });
}

const sidecarTables = ['nfo_overrides', 'artwork_selections', 'episode_overrides', 'episode_file_overrides', 'custom_tags'] as const;

export function restoreSnapshot(db: Database.Database, folder: string, input: Sidecar, onlyIfUnbound = false) {
  const data = sidecarSchema.parse(input);
  return db.transaction(() => {
    if (onlyIfUnbound && getBinding(db, folder)) return false;
    for (const table of sidecarTables) db.prepare(`DELETE FROM ${table} WHERE folder_path=?`).run(folder);
    if (data.binding) putBinding(db, folder, data.binding);
    else db.prepare('DELETE FROM bindings WHERE folder_path=?').run(folder);
    for (const row of data.overrides) if (row.value !== '') db.prepare('INSERT INTO nfo_overrides VALUES (?,?,?,?)').run(folder, row.scope, row.field, row.value);
    for (const row of data.artwork_selections) db.prepare('INSERT INTO artwork_selections VALUES (?,?,?,?,?,?)').run(folder, row.slot, row.url, row.language, row.score, Date.now());
    for (const row of data.episode_overrides) db.prepare('INSERT INTO episode_overrides VALUES (?,?,?,?)').run(folder, row.season, row.episode, row.tvdb_episode_id);
    for (const row of data.episode_file_overrides) db.prepare('INSERT INTO episode_file_overrides VALUES (?,?,?,?,?)').run(folder, join(folder, ...row.file_path.split('/')), row.season, row.episode, row.external_id);
    for (const tag of data.custom_tags) db.prepare('INSERT INTO custom_tags VALUES (?,?,?)').run(folder, tag, Date.now());
    return true;
  })();
}

export function forgetFolder(db: Database.Database, folder: string) {
  db.transaction(() => {
    for (const table of [...sidecarTables, 'bindings', 'item_state', 'active_artwork', 'custom_artwork', 'watcher_review']) {
      db.prepare(`DELETE FROM ${table} WHERE folder_path=?`).run(folder);
    }
  })();
}

export function readCache(db: Database.Database, key: string, now = Date.now()): unknown | null {
  const row = db.prepare('SELECT payload FROM provider_cache WHERE key=? AND fetched_at + ttl * 1000 > ?').get(key, now) as { payload: string } | undefined;
  return row ? JSON.parse(row.payload) : null;
}

export function writeCache(db: Database.Database, key: string, payload: unknown, ttlSeconds: number, now = Date.now()) {
  db.prepare('INSERT INTO provider_cache VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at,ttl=excluded.ttl')
    .run(key, JSON.stringify(payload), now, ttlSeconds);
}
