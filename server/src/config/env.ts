export type ProcessEnv = Record<string, string | undefined>;

const truthy = (value: string | undefined, fallback = false) =>
  value === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
const integer = (value: string | undefined, fallback: number, min: number, max: number) => {
  const n = value === undefined || value.trim() === '' ? fallback : Number(value);
  if (!Number.isInteger(n)) throw new Error(`Expected an integer, received ${value}`);
  return Math.max(min, Math.min(max, n));
};
const list = (value = '') => [...new Set(value.split(',').map(s => s.trim()).filter(Boolean))];

export function loadEnv(source: ProcessEnv = process.env) {
  const origins = list(source.CORS_ALLOW_ORIGINS);
  if (origins.includes('*')) throw new Error('CORS_ALLOW_ORIGINS must contain explicit origins, never *');
  return {
    api_token: source.API_TOKEN || undefined,
    media_root: source.MEDIA_ROOT || '/media',
    config_dir: source.CONFIG_DIR || '/config',
    tvdb_api_key: source.TVDB_API_KEY,
    tvdb_pin: source.TVDB_PIN,
    tmdb_api_key: source.TMDB_API_KEY,
    fanart_api_key: source.FANART_API_KEY,
    listen_host: source.LISTEN_HOST || '0.0.0.0',
    listen_port: integer(source.LISTEN_PORT, 8000, 0, 65535),
    log_level: source.LOG_LEVEL || 'INFO',
    tz: source.TZ || 'America/Chicago',
    cors_allow_origins: origins,
    trusted_hosts: list(source.TRUSTED_HOSTS).map(s => s.toLowerCase()),
    watcher_enabled: truthy(source.WATCHER_ENABLED, true),
    watcher_debounce_seconds: integer(source.WATCHER_DEBOUNCE_SECONDS, 30, 1, 3600),
    watcher_max_inflight: integer(source.WATCHER_MAX_INFLIGHT, 2, 1, 64),
    watcher_kill_switch: truthy(source.WATCHER_KILL_SWITCH),
  };
}

export type Env = ReturnType<typeof loadEnv>;
