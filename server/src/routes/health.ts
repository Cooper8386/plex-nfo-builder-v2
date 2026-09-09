import type { FastifyInstance } from 'fastify';
import type { Env } from '../config/env.js';
import { credential, type Settings } from '../config/settings.js';

export function healthRoutes(app: FastifyInstance, env: Env, settings: () => Settings, version: string) {
  app.get('/api/health', async () => {
    const value = settings();
    return {
      ok: true, version, media_root: env.media_root,
      tvdb_configured: Boolean(credential(value, env, 'tvdb_api_key')),
      tmdb_configured: Boolean(credential(value, env, 'tmdb_api_key')),
      fanart_configured: Boolean(credential(value, env, 'fanart_api_key')),
      metadata_source: value.metadata_source,
      plex_configured: Boolean(value.plex_url && credential(value, env, 'plex_token')),
      plex_auto_refresh: value.plex_auto_refresh,
    };
  });
}
