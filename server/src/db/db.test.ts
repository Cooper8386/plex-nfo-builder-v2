import { expect, test } from 'vitest';
import { openDatabase } from './connection.js';
import { forgetFolder, getBinding, putBinding, readCache, writeCache } from './queries.js';
import { bindingSchema } from '../services/sidecar/format.js';
import { withSandbox } from '../../tests/support/sandbox.js';

test('db initializes every entity, WAL, foreign keys, and additive migrations idempotently', async () => withSandbox(async box => {
  let db = await openDatabase(box.config);
  try {
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(row => row.name);
    expect(tables.sort()).toEqual(['libraries', 'bindings', 'item_state', 'artwork_selections', 'active_artwork', 'episode_overrides', 'episode_file_overrides', 'nfo_overrides', 'custom_artwork', 'custom_tags', 'schedules', 'watcher_review', 'provider_cache'].sort());
    db.prepare('INSERT INTO libraries(name,kind,detected_at) VALUES (?,?,?)').run('TV', 'tv', 100);
    db.close();
    db = await openDatabase(box.config);
    expect(db.prepare('SELECT name FROM libraries').get()).toEqual({ name: 'TV' });
    db.prepare('INSERT INTO item_state(folder_path,library,kind,date_added) VALUES (?,?,?,?)').run('/media/TV/show', 'TV', 'series', 100);
    expect(() => db.prepare('UPDATE item_state SET date_added=200').run()).toThrow('insert-only');
  } finally { db.close(); }
}));

test('db preserves binding locks and creation time, validates secondary IDs, and deduplicates tags', async () => withSandbox(async box => {
  const db = await openDatabase(box.config);
  try {
    const binding = bindingSchema.parse({ kind: 'series', provider: 'tvdb', external_id: '1', source_locked: true });
    expect(putBinding(db, '/show', binding)).toBe(true);
    const created = db.prepare('SELECT created_at FROM bindings').get();
    expect(putBinding(db, '/show', { ...binding, external_id: '2' }, true)).toBe(false);
    expect(getBinding(db, '/show')?.external_id).toBe('1');
    expect(putBinding(db, '/show', { ...binding, external_id: '2' })).toBe(true);
    expect(db.prepare('SELECT created_at FROM bindings').get()).toEqual(created);
    expect(() => putBinding(db, '/show', { ...binding, secondary_provider: 'tvdb', secondary_external_id: '99' })).toThrow();
    expect(() => db.prepare("UPDATE bindings SET secondary_provider='tvdb', secondary_external_id='99'").run()).toThrow();
    db.prepare('INSERT INTO custom_tags VALUES (?,?,?)').run('/show', 'Anime', 1);
    expect(() => db.prepare('INSERT INTO custom_tags VALUES (?,?,?)').run('/show', 'anime', 2)).toThrow();
    db.prepare('INSERT INTO active_artwork VALUES (?,?,?,?)').run('/show', 'poster', '/show/poster.jpg', 1);
    forgetFolder(db, '/show');
    expect(getBinding(db, '/show')).toBeNull();
    expect(db.prepare('SELECT * FROM custom_tags').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM active_artwork').all()).toEqual([]);
  } finally { db.close(); }
}));

test('db provider cache shares namespaced keys and expires at TTL boundary', async () => withSandbox(async box => {
  const db = await openDatabase(box.config);
  try {
    writeCache(db, 'tvdb:series:1', { title: 'TVDB' }, 10, 1000);
    writeCache(db, 'tmdb:series:1', { title: 'TMDB' }, 10, 1000);
    expect(readCache(db, 'tvdb:series:1', 10999)).toEqual({ title: 'TVDB' });
    expect(readCache(db, 'tmdb:series:1', 10999)).toEqual({ title: 'TMDB' });
    expect(readCache(db, 'tvdb:series:1', 11000)).toBeNull();
  } finally { db.close(); }
}));
