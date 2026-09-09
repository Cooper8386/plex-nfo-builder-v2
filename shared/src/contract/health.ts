import type { MetadataSource } from './index.js';

export interface HealthResponse {
  ok: boolean;
  version: string;
  media_root: string;
  tvdb_configured: boolean;
  tmdb_configured: boolean;
  fanart_configured: boolean;
  metadata_source: MetadataSource;
  plex_configured: boolean;
  plex_auto_refresh: boolean;
}
