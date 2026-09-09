import type { MetadataSource, OkResponse } from './index.js';

export interface Settings {
  preferred_language: string;
  fallback_languages: string[];
  include_original_title: boolean;
  cache_ttl_hours: number;
  overwrite_foreign_nfo: boolean;
  tvdb_api_key: string | null;
  tvdb_pin: string | null;
  tmdb_api_key: string | null;
  fanart_api_key: string | null;
  auto_match_threshold: number;
  metadata_source: MetadataSource;
  fanart_enabled: boolean;
  tmdb_artwork_enabled: boolean;
  preferred_artwork_source: 'auto' | MetadataSource;
  plex_url: string | null;
  plex_token: string | null;
  plex_auto_refresh: boolean;
  plex_refresh_delay_seconds: number;
  plex_path_mappings: { from: string; to: string }[];
  rename_episode_template: string;
  rename_daily_template: string;
  rename_anime_template: string;
  rename_series_folder_template: string;
  rename_season_folder_template: string;
  rename_movie_template: string;
  rename_movie_folder_template: string;
  rename_enabled: boolean;
  auto_sweep_orphans: boolean;
  tvdb_artwork_languages: string[];
  tmdb_artwork_languages: string[];
  tvdb_artwork_allow_null_language: boolean;
  tmdb_artwork_allow_null_language: boolean;
  watcher_enabled: boolean | null;
  watcher_debounce_seconds: number | null;
}
export type SettingsSecret = 'tvdb_api_key' | 'tvdb_pin' | 'tmdb_api_key' | 'fanart_api_key' | 'plex_token';
export type SettingsResponse = Omit<Settings, SettingsSecret> & Record<`${SettingsSecret}_configured`, boolean>;
/** Empty secret strings mean leave unchanged; omitted fields are not updated. */
export type UpdateSettingsRequest = Partial<Settings>;
export type UpdateSettingsResponse = OkResponse;
