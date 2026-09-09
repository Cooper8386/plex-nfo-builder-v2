import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { Env, ProcessEnv } from './env.js';
import { atomicWrite } from '../services/fs/atomic.js';

const languages = z.array(z.string()).transform(values => [...new Set(values.map(v => v.trim().toLowerCase()).filter(Boolean))]);
const secret = z.string().nullable().default(null);
const episodeTail = '{[Custom Formats]}{[Quality Full]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[MediaInfo VideoCodec]}{-Release Group}';
export const settingsSchema = z.object({
  preferred_language: z.string().trim().toLowerCase().min(1).default('eng'),
  fallback_languages: languages.default(['eng']),
  include_original_title: z.boolean().default(true),
  cache_ttl_hours: z.number().int().positive().default(168),
  overwrite_foreign_nfo: z.boolean().default(true),
  tvdb_api_key: secret, tvdb_pin: secret, tmdb_api_key: secret, fanart_api_key: secret,
  auto_match_threshold: z.number().min(0).max(100).default(85),
  metadata_source: z.string().transform(v => v.trim().toLowerCase() === 'tmdb' ? 'tmdb' as const : 'tvdb' as const).default('tvdb'),
  fanart_enabled: z.boolean().default(true), tmdb_artwork_enabled: z.boolean().default(true),
  preferred_artwork_source: z.string().transform(v => {
    const source = v.trim().toLowerCase();
    return ['tvdb', 'tmdb'].includes(source) ? source : 'auto';
  }).default('auto'),
  plex_url: z.string().trim().transform(v => v.replace(/\/+$/, '') || null).nullable().default(null),
  plex_token: secret, plex_auto_refresh: z.boolean().default(false),
  plex_refresh_delay_seconds: z.number().int().transform(v => Math.max(0, Math.min(600, v))).default(5),
  plex_path_mappings: z.array(z.object({ from: z.string().trim(), to: z.string().trim() })).transform(values => values.filter(v => v.from || v.to)).default([]),
  rename_episode_template: z.string().default(`{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle} ${episodeTail}`),
  rename_daily_template: z.string().default(`{Series TitleYear} - {Air-Date} - {Episode CleanTitle} ${episodeTail}`),
  rename_anime_template: z.string().default('{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle} {[Custom Formats]}{[Quality Full]}{[MediaInfo VideoDynamicRangeType]}[{MediaInfo VideoBitDepth}bit]{[MediaInfo VideoCodec]}[{Mediainfo AudioCodec} { Mediainfo AudioChannels}]{MediaInfo AudioLanguages}{-Release Group}'),
  rename_series_folder_template: z.string().default('{Series TitleYear} {tvdb-{TvdbId}}'),
  rename_season_folder_template: z.string().default('Season {season:00}'),
  rename_movie_template: z.string().default('{Movie CleanTitle} {(Release Year)} {tmdb-{TmdbId}} {edition-{Edition Tags}} {[Custom Formats]}{[Quality Full]}{[MediaInfo 3D]}{[MediaInfo VideoDynamicRangeType]}{[Mediainfo AudioCodec}{ Mediainfo AudioChannels]}{[Mediainfo VideoCodec]}{-Release Group}'),
  rename_movie_folder_template: z.string().default('{Movie CleanTitle} ({Release Year}) {tmdb-{TmdbId}}'),
  rename_enabled: z.boolean().default(true), auto_sweep_orphans: z.boolean().default(true),
  tvdb_artwork_languages: languages.default([]), tmdb_artwork_languages: languages.default([]),
  tvdb_artwork_allow_null_language: z.boolean().default(true), tmdb_artwork_allow_null_language: z.boolean().default(true),
  watcher_enabled: z.boolean().nullable().default(null),
  watcher_debounce_seconds: z.number().int().transform(v => Math.max(1, Math.min(3600, v))).nullable().default(null),
}).strict();

export type Settings = z.infer<typeof settingsSchema>;
export const secretFields = ['tvdb_api_key', 'tvdb_pin', 'tmdb_api_key', 'fanart_api_key', 'plex_token'] as const;

export class SettingsStore {
  private current?: Settings;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(readonly path: string, private report: (message: string) => void = console.error) {}

  async load(): Promise<Settings> {
    if (this.current) return structuredClone(this.current);
    let contents: string;
    try {
      contents = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.current = settingsSchema.parse({});
        return structuredClone(this.current);
      }
      this.report(`Cannot read settings file: ${this.path}`);
      throw error;
    }
    try {
      this.current = settingsSchema.parse(JSON.parse(contents));
    } catch {
      const message = `Invalid settings file: ${this.path}. Repair it before saving settings.`;
      this.report(message);
      throw new Error(message);
    }
    return structuredClone(this.current);
  }

  save(patch: unknown): Promise<Settings> {
    const operation = this.pending.then(async () => {
      const current = await this.load();
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Settings update must be an object');
      const fields = { ...patch } as Record<string, unknown>;
      for (const key of secretFields) if (fields[key] === '') delete fields[key];
      const next = settingsSchema.parse({ ...current, ...fields });
      await mkdir(dirname(this.path), { recursive: true });
      await atomicWrite(this.path, `${JSON.stringify(next, null, 2)}\n`);
      this.current = next;
      return structuredClone(next);
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }
}

export function credential(settings: Settings, env: Env, key: typeof secretFields[number], processEnv: ProcessEnv = process.env) {
  return settings[key] || (key in env ? env[key as keyof Env] as string | undefined : undefined) || processEnv[key.toUpperCase()] || null;
}

export function publicSettings(settings: Settings, env: Env) {
  const result: Record<string, unknown> = { ...settings };
  for (const key of secretFields) {
    delete result[key];
    result[`${key}_configured`] = Boolean(credential(settings, env, key));
  }
  return result;
}

export function watcherSettings(settings: Settings, env: Env) {
  return {
    enabled: !env.watcher_kill_switch && (settings.watcher_enabled ?? env.watcher_enabled),
    debounce_seconds: settings.watcher_debounce_seconds ?? env.watcher_debounce_seconds,
    max_inflight: env.watcher_max_inflight,
  };
}
