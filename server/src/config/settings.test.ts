import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { credential, publicSettings, SettingsStore, settingsSchema, watcherSettings } from './settings.js';
import { loadEnv } from './env.js';
import { withSandbox } from '../../tests/support/sandbox.js';

test('settings partial and concurrent updates preserve untouched fields and empty secrets', async () => withSandbox(async box => {
  const path = join(box.config, 'settings.json');
  const store = new SettingsStore(path);
  await store.save({ tvdb_api_key: 'secret', preferred_language: 'jpn' });
  await Promise.all([store.save({ metadata_source: 'tmdb' }), store.save({ fanart_enabled: false, tvdb_api_key: '' })]);
  const settings = await new SettingsStore(path).load();
  expect(settings).toMatchObject({ preferred_language: 'jpn', tvdb_api_key: 'secret', metadata_source: 'tmdb', fanart_enabled: false, overwrite_foreign_nfo: true });
  settings.preferred_language = 'modified clone';
  expect((await store.load()).preferred_language).toBe('jpn');
  expect(await readdir(box.config)).toEqual(['settings.json']);
}));

test.each(['{broken', '{"cache_ttl_hours":"invalid"}', 'null'])('settings corruption is reported and cannot be silently overwritten: %s', async contents => withSandbox(async box => {
  const path = join(box.config, 'settings.json');
  await writeFile(path, contents);
  const report = vi.fn();
  const store = new SettingsStore(path, report);
  await expect(store.load()).rejects.toThrow('Invalid settings file');
  await expect(store.save({ metadata_source: 'tmdb' })).rejects.toThrow('Invalid settings file');
  expect(report).toHaveBeenCalled();
  expect(await readFile(path, 'utf8')).toBe(contents);
}));

test('settings validate updates before writing and recover after a rejected save', async () => withSandbox(async box => {
  const path = join(box.config, 'settings.json');
  const store = new SettingsStore(path);
  await store.save({ preferred_language: 'eng' });
  const original = await readFile(path, 'utf8');
  await expect(store.save({ cache_ttl_hours: -1 })).rejects.toThrow();
  await expect(store.save({ unknown_setting: true })).rejects.toThrow();
  expect(await readFile(path, 'utf8')).toBe(original);
  await store.save({ preferred_language: 'kor' });
  expect((await store.load()).preferred_language).toBe('kor');
}));

test('settings normalize provider, language, Plex, and watcher values', () => {
  expect(settingsSchema.parse({ preferred_language: ' JPN ', fallback_languages: [' ENG ', 'eng', 'jpn', ''], tmdb_artwork_languages: ['JA', 'ja'], metadata_source: ' TMDB ', preferred_artwork_source: 'invalid', plex_url: ' https://plex.example/// ', plex_refresh_delay_seconds: 999, watcher_debounce_seconds: 0 }))
    .toMatchObject({ preferred_language: 'jpn', fallback_languages: ['eng', 'jpn'], tmdb_artwork_languages: ['ja'], metadata_source: 'tmdb', preferred_artwork_source: 'auto', plex_url: 'https://plex.example', plex_refresh_delay_seconds: 600, watcher_debounce_seconds: 1 });
  expect(settingsSchema.parse({ plex_refresh_delay_seconds: -1 }).plex_refresh_delay_seconds).toBe(0);
  expect(settingsSchema.parse({ metadata_source: 'bad' }).metadata_source).toBe('tvdb');
});

test('settings credentials resolve user, env, process in order and public output hides secrets', () => {
  const settings = settingsSchema.parse({ tvdb_api_key: 'user-key' });
  const env = loadEnv({ TVDB_API_KEY: 'env-key' });
  expect(credential(settings, env, 'tvdb_api_key', { TVDB_API_KEY: 'process-key' })).toBe('user-key');
  settings.tvdb_api_key = null;
  expect(credential(settings, env, 'tvdb_api_key', { TVDB_API_KEY: 'process-key' })).toBe('env-key');
  expect(credential(settings, loadEnv({}), 'tvdb_api_key', { TVDB_API_KEY: 'process-key' })).toBe('process-key');
  const visible = publicSettings(settings, env);
  expect(visible.tvdb_api_key_configured).toBe(true);
  expect(visible).not.toHaveProperty('tvdb_api_key');
  expect(JSON.stringify(visible)).not.toContain('env-key');
});

test('settings env defaults, watcher override and kill switch', () => {
  const env = loadEnv({});
  expect(env).toMatchObject({ media_root: '/media', config_dir: '/config', listen_port: 8000, watcher_enabled: true, watcher_debounce_seconds: 30, watcher_max_inflight: 2, tz: 'America/Chicago' });
  expect(watcherSettings(settingsSchema.parse({}), env)).toEqual({ enabled: true, debounce_seconds: 30, max_inflight: 2 });
  expect(watcherSettings(settingsSchema.parse({ watcher_enabled: false, watcher_debounce_seconds: 15 }), env).enabled).toBe(false);
  expect(watcherSettings(settingsSchema.parse({ watcher_enabled: true }), loadEnv({ WATCHER_KILL_SWITCH: 'true' })).enabled).toBe(false);
  expect(loadEnv({ WATCHER_DEBOUNCE_SECONDS: '9999' }).watcher_debounce_seconds).toBe(3600);
  expect(() => loadEnv({ CORS_ALLOW_ORIGINS: '*' })).toThrow('never *');
});
