# Plex NFO Builder v2

Node 24 / TypeScript rebuild tracked in [issue #1](https://github.com/Cooper8386/plex-nfo-builder-v2/issues/1), based on `REPO_SPEC.md`. Version 0.8.0 implements milestone 1 phases 1–8. This is a foundation, not a feature-complete media manager.

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

The React placeholder runs separately with `pnpm --filter client dev`. The server currently exposes only health; UI serving and the remaining API routes arrive in later phases.

API types are exported from the `shared` workspace package. The server health route and client type entry point consume that package. `pnpm --filter shared test` checks the contract assertions with TypeScript before running Vitest. This phase adds no endpoint behavior or network client.

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

`openDatabase(configDir)` creates `app.db` with WAL, foreign keys, and versioned additive migrations. Schema work performs no media-tree scan and runs only when called. The phase 7 worker layer must own synchronous SQLite work when it is connected to live routes.

Sidecars use a fresh version 2 format with relative episode file paths. Legacy sidecars are deliberately unsupported. `recoverSidecar(db, folder)` restores all sidecar state only when that folder has no binding; phase 8 will call it during scans. Missing or truncated sidecars read as absent. Binding locks and secondary-provider constraints are enforced; tags deduplicate without case sensitivity.

Use one `SettingsStore` per settings file. It caches reads, serializes field-level updates, and writes through a sibling temporary file followed by fsync and replacement. Corrupt settings are reported and must be repaired before a save can succeed. Empty secret strings preserve existing credentials. Credential priority is user settings, captured environment, then current process environment. `overwrite_foreign_nfo` defaults to true, as decided in issue #1.

API and docs paths fail closed: 503 without a configured server token, 401 for invalid client credentials. Token priority is `X-API-Token`, Bearer authorization, then `api_token` query parameter. Access logs omit query strings. CORS is disabled by default; explicit origin and host allowlists are supported.

See `IMPLEMENTATION.md` for the phase checkpoint and validation record.
