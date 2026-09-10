# Plex NFO Builder

Generate Plex-compatible NFO files and artwork from TVDB, TMDB and fanart.tv.

## Docker Compose

```yaml
services:
  plex-nfo-builder:
    image: ghcr.io/cooper8386/plex-nfo-builder-v2:latest
    container_name: plex-nfo-builder
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Etc/UTC
      - API_TOKEN=replace-with-a-long-random-value
    volumes:
      - /path/to/media:/media
      - /path/to/config:/config
    ports:
      - 8765:8000
    restart: unless-stopped
```

Save this as `compose.yml`, change the token and paths, then run `docker compose up -d`. Open `http://localhost:8765` and enter the same token. Immediate subdirectories of `/media` are detected as libraries; provider credentials and Plex settings are entered in the web UI.

`PUID` and `PGID` must match the account that owns the media files. The container prepares `/config` for that account but never changes `/media`. Both mounts must be writable because the app stores its database in `/config` and writes NFO and artwork files beside your media.

Images support Linux amd64 and arm64. `latest`, `edge` and `main` follow the main branch; version tags such as `0.22.0` pin a release.

## Updating

```sh
docker compose pull
docker compose up -d
```

Back up `/config` before upgrading. The app uses a shared API token and should be exposed only through a trusted network or TLS reverse proxy.

<details>
<summary>Advanced configuration</summary>

| Variable | Default | Purpose |
| --- | --- | --- |
| `MEDIA_ROOT`, `CONFIG_DIR` | `/media`, `/config` | Container paths |
| `LISTEN_HOST`, `LISTEN_PORT` | `0.0.0.0`, `8000` | Internal listener |
| `TVDB_API_KEY`, `TVDB_PIN`, `TMDB_API_KEY`, `FANART_API_KEY`, `PLEX_TOKEN` | unset | Optional credentials; UI settings take precedence |
| `WATCHER_ENABLED`, `WATCHER_DEBOUNCE_SECONDS`, `WATCHER_MAX_INFLIGHT` | `true`, `30`, `2` | Watcher controls |
| `WATCHER_KILL_SWITCH` | `false` | Force the watcher off |
| `LOG_LEVEL`, `TZ` | `INFO`, `America/Chicago` | Logging and schedule timezone |
| `CORS_ALLOW_ORIGINS`, `TRUSTED_HOSTS` | unset | Comma-separated allowlists |

</details>

<details>
<summary>Development</summary>

Requires Node 24 and pnpm 11.19.0.

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run `pnpm dev` for the server and `pnpm --filter client dev` for frontend hot reload. Use `docker build -t plex-nfo-builder .` to build the production image locally.

</details>

<details>
<summary>Legacy library reset</summary>

The v1-to-v2 cutover tool deletes existing NFOs, app sidecars and standard artwork. Stop all metadata writers and back up the library first. Preview and confirmation are separate runs:

```sh
pnpm reset-library --media-root /path/to/media
pnpm reset-library --media-root /path/to/media --confirm
```

It preserves media, subtitles, audio, unknown artwork and files changed after the preview. Routine upgrades do not need a reset.

</details>
