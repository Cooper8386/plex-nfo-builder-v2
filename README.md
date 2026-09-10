# Plex NFO Builder v2

Generate Plex-compatible NFO files and artwork from TVDB, TMDB and fanart.tv. Node 24, TypeScript, React and SQLite. [Issue #1](https://github.com/Cooper8386/plex-nfo-builder-v2/issues/1) and `IMPLEMENTATION.md` track implementation and decisions.

Version 0.22.0 packages the API and UI in one non-root container. Library scans, builds, episode mapping, captured rename/cleanup previews, manual season posters, settings, watcher review and schedules are available. Automatic matching poster sets remain milestone 2. Rotating application logs and automatic post-build Plex refresh remain unassigned plan gaps; the Logs endpoint reads an existing app.log, and manual Plex refresh is available.

## Docker Compose

1. Copy `.env.example` to `.env`. Set a strong random `API_TOKEN`, `MEDIA_PATH` to your existing media directory, and `CONFIG_PATH` to a new configuration directory. Provider credentials can be entered in Settings. Never commit `.env`.
2. Create the configuration directory. The container runs as **UID/GID 1000:1000**; grant that account write access to configuration and the media folders where it creates metadata. For a new Linux configuration directory:

   ```sh
   mkdir -p config
   sudo chown 1000:1000 config
   ```

   On Windows, use paths such as `MEDIA_PATH=D:/Media` and `CONFIG_PATH=D:/plex-nfo-config`; create the directory and allow Docker Desktop to share those paths. Keep `/config` on local storage, not SMB/NFS; `/media` may use a network-backed path.
3. Build and start:

   ```sh
   docker compose config --quiet
   docker compose up -d --build
   ```

4. Open **http://localhost:8765** and enter your API token. The UI and API share one origin; direct links such as `/libraries/TV` work.

Compose refuses an empty token, unset media path, or missing bind-mount directories. Inside the container, mounts remain `/media` and `/config`. Libraries are immediate subdirectories of `/media`. Startup binds the listener before scanning; builds use a durable queue with two workers.

After publication, deploy the registry image without building locally:

```sh
docker compose pull
docker compose up -d --no-build
```

`IMAGE_TAG=edge` follows main. Set a published version such as `0.22.0` to pin a release. Images use `ghcr.io/cooper8386/plex-nfo-builder-v2`, supporting Linux amd64 and arm64. Local-only commits have no published image until their workflow runs.

```sh
docker compose logs --tail=200 -f
docker compose down
```

Bind mounts survive `down`. Back up configuration while the app is stopped, including settings, SQLite files and custom artwork. Back up before upgrades; older images may not read newer database schemas. Runtime includes ffmpeg/ffprobe, tini, compiled server/UI and production dependencies, without source or development tooling.

## Configuration and security

`.env` supplies Compose interpolation; Node does not load it directly. Direct Node users must export variables. Compose preserves these application variables:

| Variables | Purpose |
| --- | --- |
| `API_TOKEN` | Required shared credential |
| `MEDIA_ROOT`, `CONFIG_DIR` | Direct Node paths; Compose fixes these to `/media` and `/config` |
| `LISTEN_HOST`, `LISTEN_PORT` | Default `0.0.0.0:8000` inside Docker |
| `TVDB_API_KEY`, `TVDB_PIN`, `TMDB_API_KEY`, `FANART_API_KEY`, `PLEX_TOKEN` | Optional credentials; saved settings take precedence |
| `WATCHER_ENABLED`, `WATCHER_DEBOUNCE_SECONDS`, `WATCHER_MAX_INFLIGHT` | Defaults: true, 30 seconds, 2 |
| `WATCHER_KILL_SWITCH` | Forces watcher off regardless of saved settings |
| `LOG_LEVEL`, `TZ` | Defaults: `INFO`, `America/Chicago`; schedules use UTC |
| `CORS_ALLOW_ORIGINS`, `TRUSTED_HOSTS` | Optional comma-separated explicit allowlists |

`MEDIA_PATH`, `CONFIG_PATH`, `HOST_PORT` and `IMAGE_TAG` are Compose-only settings. Keep `LISTEN_HOST=0.0.0.0` inside Docker for port forwarding. Plex URL and path mappings live in Settings.

All API and reserved docs paths require the token: **503** when unset server-side, **401** for invalid client credentials. Priority: `X-API-Token`, Bearer authorization, then `api_token` query parameter. Access logs omit query strings. UI assets are public; media/API data are protected. Unknown API routes retain JSON 404 responses. File boundaries reject escapes and links outside permitted roots.

CORS defaults off; wildcard origins are rejected. Use a TLS reverse proxy or trusted private network. This is one shared token, not multi-user authorization. Include browser and health-check hostnames in `TRUSTED_HOSTS` when enabling it.

Provider HTTP blocks private, loopback, link-local and metadata addresses, **including Plex URLs**, under the current issue decision. LAN-only Plex is therefore blocked; this release adds no exception. Further SSRF work remains milestone 2.

File operations and bulk record removals require captured previews and confirmation. Automatic orphan cleanup defaults **off**; explicitly enabling `auto_sweep_orphans` authorizes future post-build sweeps. Manual season-poster progress is separate from NFO completion; its optional filter lives inside the Library filter panel.

## Development and CI

Install Node 24 and pnpm **11.19.0**:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Export `API_TOKEN`, `MEDIA_ROOT` and `CONFIG_DIR`, then run `pnpm dev`. For frontend hot reload also run `pnpm --filter client dev`; Vite proxies API calls to `127.0.0.1:8000`. After building, `node server/dist/index.js` serves both API and `client/dist` on port 8000. Asset location does not depend on the current working directory.

Contracts live in `shared`. Tests use disposable fixtures, without real media or provider credentials. Windows skips one POSIX permissions test; the non-root Linux gate runs it. Run the same gate used by GitHub locally:

```sh
docker build --target check -t plex-nfo-builder-check .
docker build -t plex-nfo-builder .
docker run --rm -p 8000:8000 -e API_TOKEN=disposable-test-token -e WATCHER_KILL_SWITCH=true plex-nfo-builder
```

In another terminal:

```sh
curl --fail -H 'X-API-Token: disposable-test-token' http://localhost:8000/api/health
curl --fail http://localhost:8000/libraries/TV
```

CI checks pull requests and supports manual runs. Main/tag pushes call the same reusable CI before publication. It performs a frozen install, build, lint, typecheck and full tests as UID 1000, then verifies runtime health, deep links, authentication and ffprobe.

The publish workflow builds amd64/arm64 images to GHCR. Main gets `main` and `edge`; stable `vX.Y.Z` tags get semantic-version tags and `latest`. Prereleases do not replace stable `latest`. The release workflow creates GitHub releases with generated notes after CI passes. Repository Actions/package permissions must permit `GITHUB_TOKEN`; no personal token is needed. Pushing a release tag publishes externally; implementation itself does not create or push tags.

References: [Docker multi-platform Actions](https://docs.docker.com/build/ci/github-actions/multi-platform/), [GitHub release CLI](https://cli.github.com/manual/gh_release_create).

## Pre-cutover reset

**Reset only at cutover, never early against an active library.** This deletes existing NFOs, including foreign NFOs, app sidecars and standard artwork. Back up anything you want to retain. Stop the old app and other media/metadata writers first. Use a fresh configuration directory for v2; legacy sidecars are deliberately unsupported.

From a checkout with development dependencies installed:

```sh
# Preview only; inspect every path and skipped-directory warning.
pnpm reset-library --media-root /path/to/media
# At cutover, with other writers stopped, explicitly authorize deletion.
pnpm reset-library --media-root /path/to/media --confirm
```

On Windows, use a quoted path such as `--media-root "D:/Media"`. These are separate runs: `--confirm` captures and prints a fresh list before applying it. Keep writers stopped between review and execution. Reset never runs automatically during startup, upgrades or builds. The CLI is a checkout tool, excluded from the trimmed runtime image.

Reset preserves videos, subtitles, audio, season folders and unknown artwork such as `logo.png`. It skips links and unreadable paths, applies only its captured list, skips changed/replaced files, and removes actor directories only when empty. Skipped paths are reported; confirmed runs exit nonzero when any remain. Inspect those results before starting v2.

After cutover, scan libraries, configure providers and build a small sample before the full library. New v2 sidecars preserve bindings, overrides, artwork choices, episode mappings and tags using relative media paths. A database rebuild restores them for folders without bindings. Preserve these sidecars after initial cutover; routine upgrades do not need another reset.
