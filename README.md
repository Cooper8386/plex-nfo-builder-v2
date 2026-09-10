# Plex NFO Builder v2

Node 24 / TypeScript rebuild tracked in [issue #1](https://github.com/Cooper8386/plex-nfo-builder-v2/issues/1), based on `REPO_SPEC.md`. Version 0.16.0 implements milestone 1 phases 1–16. This is a foundation, not a feature-complete media manager.

## Development

Install Node 24 and pnpm 11.19.0, then run:

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Set `API_TOKEN` in your process environment before starting `pnpm dev`. The listener defaults to `0.0.0.0:8000`. `.env.example` documents all supported environment variables; `.env` files are not loaded automatically. For local development, set `CONFIG_DIR` to a writable local directory and `MEDIA_ROOT` to your media directory.

```sh
curl -H 'X-API-Token: your-token' http://localhost:8000/api/health
```

Run the frontend separately with `pnpm --filter client dev`, then open the Vite address and enter your API token. Vite proxies `/api` to `http://127.0.0.1:8000`; adjust `client/vite.config.ts` if using another server port. The frontend includes light/dark/system themes, keyboard navigation, a library sidebar, and basic title/status lists. `/libraries/:library` URLs open a selected library directly. Failed queries provide Retry; render failures provide a recovery screen.

The server exposes health, library detection/settings, items/status explanations, matching/binding, NFO override, artwork, queued build routes, and preview-confirm cleanup routes. Automatic orphan cleanup defaults to disabled; explicitly enabling auto_sweep_orphans authorizes future post-build sweeps. Manual destructive requests require dry_run=true first, then the returned preview_id and confirm=true. Season posters use saved manual choices; `/api/artwork/progress?path=...` reports selection progress separately from NFO status. The optional library filter and artwork picker arrive in phase 21; automatic matching poster sets are planned for milestone 2. Builds use one durable queue with two workers and serialize repeated requests for the same folder. Startup resumes queued jobs and detects/scans libraries after binding the listener. Full detail views, settings, and destructive UI remain phase 21. Production SPA serving remains phase 22.

API types are exported from the `shared` workspace package and consumed by the server routes and client API. `pnpm --filter shared test` checks the contract assertions with TypeScript before running Vitest. `pnpm --filter client test` checks rendered query/auth/error states, keyboard primitives, and routing; these tests also run in the root suite.

## Container skeleton

```sh
docker build -t plex-nfo-builder .
docker run --rm -p 8000:8000 -e API_TOKEN=your-token plex-nfo-builder
```

The image runs as the `node` user (UID 1000), with `/media` and `/config` volumes. Future bind mounts must grant that user access. The skeleton includes build tooling; production image trimming, ffprobe, SPA serving, Compose, and release CI are phase 22 work.

## Pre-cutover reset

Run this only when you are ready to replace the old app's metadata. It deletes foreign NFOs too. Do not run it early against an active library.

```sh
pnpm reset-library --media-root /path/to/media
# Review every path in the dry-run output, then explicitly confirm at cutover:
pnpm reset-library --media-root /path/to/media --confirm
```

The CLI lists NFOs, app sidecars, standard artwork, image thumbnails, and actor portraits by type. It preserves videos, subtitles, audio, season folders, and unknown artwork such as `logo.png`. It never follows symlinks or junctions. Unreadable directories are reported and skipped. Confirmation applies only to the captured candidate set; replaced or changed files are skipped. Actor directories are removed only when empty, so unrecognized or newly arrived files survive. Stop media writers while resetting; filesystem checks cannot provide a transaction across concurrent external writers.

## Storage and configuration

`openDatabase(configDir)` creates `app.db` with WAL, foreign keys, and versioned additive migrations. Application workers own synchronous SQLite operations. Independent worker pools keep scans and provider work away from health handling. The durable queue persists jobs and logs, resumes queued jobs, and marks interrupted jobs failed on restart.

Sidecars use a fresh version 2 format with relative episode file paths. Legacy sidecars are deliberately unsupported. Scans call `recoverSidecar(db, folder)` to restore all sidecar state only when that folder has no binding. Missing or truncated sidecars read as absent. Every binding mutation writes a sidecar; failed writes preserve the existing database binding. Locks and secondary-provider constraints are enforced; tags deduplicate without case sensitivity.

TVDB, TMDB, fanart and Plex share guarded, pooled HTTP and a SQLite cache. The default TTL is 168 hours; fanart 404s cache for one hour. Force refresh bypasses cache reads and still writes fresh results. SSRF checks block private, loopback and metadata addresses, including Plex URLs, as issue #1 requires. MediaInfo runs ffprobe in a worker with a path/mtime cache; unavailable probes fall back to filename signals. NFO building and artwork selection remain later phases.

Use one `SettingsStore` per settings file. It caches reads, serializes field-level updates, and writes through a sibling temporary file followed by fsync and replacement. Corrupt settings are reported and must be repaired before a save can succeed. Empty secret strings preserve existing credentials. Credential priority is user settings, captured environment, then current process environment. `overwrite_foreign_nfo` defaults to true, as decided in issue #1.

API and docs paths fail closed: 503 without a configured server token, 401 for invalid client credentials. Token priority is `X-API-Token`, Bearer authorization, then `api_token` query parameter. Access logs omit query strings. CORS is disabled by default; explicit origin and host allowlists are supported.

See `IMPLEMENTATION.md` for the phase checkpoint and validation record.
