# REPO_SPEC: plex-nfo-builder

Generated 2026-08-30 from dd910e5 on branch main.
Intent: rebuild
Stack for rebuild: open (current stack is FastAPI + React/Vite + SQLite + Docker; reference only)

## Summary

plex-nfo-builder is a self-hosted web app that generates Plex-compatible NFO metadata files and full local artwork sets for a user's TV shows and movies, sourced from TVDB v4 (primary), TMDB (alternate), and fanart.tv (artwork supplement). It is built to fit the folder layouts and filenames Sonarr and Radarr already produce, and ships a Sonarr/Radarr-grammar renamer for anything that doesn't. It solves a Plex-specific problem class: making Plex read correct local metadata/artwork (via the Local Media Assets agent) and stop creating duplicate library entries after release upgrades. Users are self-hosters running a media server (often on a NAS / Unraid) who want deterministic, local, recoverable metadata instead of relying on Plex's online agents.

---

## Layer 1: Contract to preserve

Everything in this layer is observable behavior a rebuild must reproduce. File citations are evidence, not a design to copy.

### Purpose and users

- One user (or a household) runs a single container against one media root. There is no multi-user model, no per-user data, no roles. Access is gated by one shared secret token.
- The app never owns the media: it writes metadata/artwork *next to* the user's video files and treats the video files as read-only inputs (never created, moved except by explicit rename, or deleted).
- The media root is bind-mounted read-write; a separate config location holds the database, logs, and settings.

### Features

#### Automatic library detection
Every immediate subdirectory of the media root becomes a "library" at startup and on demand; there is no hardcoded `tv`/`movies`/`anime`. A library has a name, a kind (`tv` | `movies` | `mixed`), an enabled flag, and a detection timestamp. Libraries can be disabled or removed from the app without touching disk. (`services/scanner.py` detect_libraries; `db.py` libraries table.)

#### Three metadata sources with per-show override + lock
TVDB v4 is the default provider; TMDB is an alternate; fanart.tv supplements artwork only. The active source can be set globally, per-library (override), or per-show (a binding with a lock so auto-match never silently swaps it). TMDB image requests honor each title's *original language* so foreign-language shows (anime, K-dramas) surface their fan-uploaded artwork. (README "three metadata sources"; `config.py` effective_metadata_source; `services/matcher.py`.)

#### Visual folder picker
A sidebar/browse UI lists directories under the media root so the user never types a path. (`GET /api/browse`; frontend Sidebar.)

#### Auto + manual matching with persistent bindings
- **Folder ID (primary signal):** a folder or filename ending `{tvdb-N}` / `{tmdb-N}` / `{imdb-N}` binds directly with no search.
- **Filename ID (movies):** a `{tmdb-N}` in a movie's filename is recorded as a `<uniqueid type="tmdb">` even when TVDB is used for the rest.
- **Auto search:** with no ID tag, fuzzy title+year search against the active provider; a configurable confidence threshold (default 85) gates acceptance.
- **Manual match:** search → Bind; the binding persists so re-runs skip search.
- Bindings survive a full database wipe because they are mirrored to an on-disk sidecar (see Data model).
(`services/matcher.py`; `POST /api/match/*`.)

#### Plex NFO output
Writes, per the Plex NFO convention: `tvshow.nfo`, `season.nfo` (only when a season name/plot or override exists; season 0 skipped unless overridden), per-episode `<video-stem>.nfo`, and per-movie `<video-stem>.nfo`. Every NFO carries a provenance header comment (see below). Empty `<uniqueid>` tags are never emitted. All NFO writes are atomic. These two guarantees exist specifically to stop Plex reading a torn/ambiguous NFO and spawning a duplicate library entry. (`services/nfo.py`, `services/builder.py`.)

#### Manual NFO field overrides
Per series/movie, per season, or per episode the user can override `title`, `sorttitle`, `originaltitle`, `tagline`, `plot`. An empty value falls back to the source. Overrides are keyed by scope (`series` | `movie` | `season-NN` | `episode-<external-id>`) and survive renames and rebuilds. (`POST /api/overrides`; `db.py` nfo_overrides.)

#### Sidecar recovery
Every bound folder gets a `.plex-nfo-builder.json` sidecar carrying binding, overrides, artwork selections, episode mappings, secondary id, and custom tags. It is the on-disk source of truth: a full database wipe is recoverable directly from the media library, restored on the next scan of each folder. (`services/sidecar.py`.)

#### Per-show wipe
A per-show action deletes every generated NFO and artwork file in one operation while leaving season folders and media files intact. Per-episode `<stem>-thumb.{jpg,jpeg,png}` thumbnails next to videos are wiped too, including orphans left by previous renames. A dry-run preview lists files and counts before deletion. (`POST /api/items/clean`; `services/cleaner.py`.)

#### Library-wide Danger Zone
Three library-scoped bulk operations, each requiring a dry-run preview + explicit confirm before touching disk:
- **Sweep orphaned sidecars** — delete `<stem>.nfo` + `<stem>-thumb.*` left behind by Sonarr/Radarr release upgrades.
- **Wipe ALL NFOs + artwork** — every tracked folder in the library.
- **Blast every sidecar** — delete every `.plex-nfo-builder.json` (NFOs/artwork untouched).
(`POST /api/libraries/{name}/wipe-nfo`, `/wipe-sidecars`, `/orphans/sweep`.)

#### Orphan companion sweeper
Fixes the "show appears twice in Plex despite one folder" symptom: Sonarr/Radarr swaps a release, the new video arrives, but the old `<stem>.nfo` and `<stem>-thumb.*` are left orphaned; Plex reads the orphan's `<uniqueid>` and creates a duplicate entry. The app sweeps these orphans automatically after every successful build (toggleable, default on), surfaces an alert on the detail page when orphans are detected, and exposes a one-shot library-wide sweep. The sweep is video-driven: it deletes only `<stem>.nfo` / `<stem>-thumb.*` whose stem is not a live video stem, and (contract as stated) never touches `tvshow.nfo`, `season.nfo`, show-level artwork, videos, subtitles, or audio. **[See Behavioral quirks — this contract is violated for root-video layouts.]** (`services/orphans.py`.)

#### Secondary provider id
When the primary provider's record doesn't cross-reference the other source, the user can pin a secondary TMDB/TVDB id (paste or in-place search). It feeds the cross-provider artwork resolver, the fanart.tv lookup, and the NFO `<uniqueid>` block, and is mirrored to the sidecar. (`POST /api/match/secondary`.)

#### Rename to scheme
Preview-then-apply renamer using full Sonarr/Radarr token grammar; defaults match Trash Guides schemes. Per-file preview shows `from → to`, conflict badges (`exists`/`duplicate`), auto-checked rows (except unchanged/conflicting), a series-type selector (Auto / Standard / Daily / Anime), an ad-hoc template override, and a release-group override field for fansub releases. Renames are atomic per file. Companion files travel with the video: matching `<stem>.nfo`, `<stem>-thumb.{jpg,png}`, and subtitle sidecars (`.srt`, `.ass`, `.ssa`, `.vtt`, `.sub`, `.idx`, `.sup`, including `.en`/`.en.forced` language variants) are renamed in lockstep. Cross-folder renames are refused. Per-file mapping overrides migrate with the file. (`services/renamer.py`; `POST /api/episodes/rename/preview|apply`.)

Codec, bit depth, HDR/DV type, audio codec (with Atmos/DTS-HD MA/DTS-X detection), audio channels, audio languages, quality (source word + resolution), and release group are extracted from each file via `ffprobe`, cached by `(path, mtime)`. (`services/mediainfo.py`.)

#### Provenance and status classification
Every NFO the app writes starts with a header comment carrying app version, source id, a sha256 content hash of the NFO body, and a generation timestamp. The scanner reads only the first ~2 KB of each NFO to classify each item quickly as:
- `none` — no NFO files.
- `partial` — `tvshow.nfo` plus some-but-not-all episode NFOs.
- `complete` — `tvshow.nfo` and an NFO per expected episode, all carrying our provenance comment (or no foreign NFOs present).
- `foreign` — NFOs exist but were written by something else (Sonarr/Plex Dance/etc.); preserved, not overwritten unless the user opts in.
- `mixed` — a mix of provenance and foreign NFOs.
- `stale` — declared as a valid value but **not currently produced** by the classifier. **[See quirks.]**
(`services/scanner.py`.)

#### Artwork
Written directly to the item folder with Plex-standard filenames (no hidden subfolder, no symlinks): `poster.jpg`, `background.jpg`, `banner.jpg`, `clearlogo.png`, per-season `SeasonNN-poster.jpg` and `season-specials-poster.jpg` (season 0), and per-episode `<stem>-thumb.jpg`. By default the highest-scored variant in the preferred language is chosen (falling back across languages). The Artwork tab lets the user override any slot, including per-season posters, per provider (TVDB / TMDB / fanart.tv / custom upload / custom URL). Selections persist and re-apply on every build. Every NFO also embeds the source CDN URL in `<thumb>` / `<fanart>` tags so Plex can fall back to the URL if a local file is missing.

**Per-provider artwork language filter:** the user can whitelist accepted languages per provider (TVDB 3-letter ISO 639-2, TMDB 2-letter ISO 639-1) and toggle whether language-less artwork is included. Available languages are queried live per provider. If the filter would leave a title with no artwork, the unfiltered list is used as a fallback so no title ends up blank. An empty whitelist means no filter. (`services/artwork.py`, `services/artwork_resolver.py`, `services/fanart.py`.)

**Actor portraits:** after every build, each cast member's headshot is downloaded to `<item>/.actors/<Actor Name>.jpg` (Kodi/Jellyfin/Plex convention) so Plex's Local Media Assets agent reads them directly and they survive online-agent re-scrapes. Capped at 60 portraits per build, 8 concurrent. (`services/builder.py`.)

#### Per-episode thumbnail picker (TMDB)
Every episode in the Overrides tab has a thumbnail picker. TMDB ships multiple stills per episode (grid); TVDB ships one (degrades to a single tile + note). An "Auto" tile clears the override. Selections are keyed by external episode id (so renames preserve them) and mirrored to the sidecar. Chosen still is saved as `<stem>-thumb.jpg` on the next build. (`GET /api/episodes/thumb-candidates`, `POST /api/episodes/thumb-select`.)

#### "Why partial?" explanation
Every status pill on a detail page is clickable and opens a popover that re-walks the folder live: per-season coverage (videos vs NFOs), exact missing/foreign filenames, orphan videos in the show root, and a plain-English list of reasons the item isn't `complete`. (`GET /api/items/nfo-explain`.)

#### Filesystem watcher
Watches each enabled library root recursively. New video files / directory events collapse to the show folder, debounce (default 30s, resets per event), and wait for the folder to be size/mtime-stable before dispatch. Pipeline: detect kind → if bound, rescan + queue build; else auto-match → on success scan + write sidecar + queue build; on failure/low-confidence/error enqueue a `watcher_review` row for manual attention. Concurrency capped (default 2). A kill switch env var forces it off. A review queue UI supports retry/dismiss/clear. **[See quirks — the auto-build hand-off is broken.]** (`services/watcher.py`.)

#### Scheduler
Cron-scheduled jobs (5-field, UTC) per library (or all libraries) with actions `scan_only`, `match_only`, `build_only`, `match_and_build`, `full`. Create/list/update/delete/run-now via UI; each row tracks last run + status. (`services/scheduler.py`; `/api/schedules`.)

#### Library views, sort, filter, search, scroll restoration
Poster grid (default), dense list, and per-item detail. A three-way **All / Needs work / Complete** status filter and a **Sort** dropdown (Title A-Z, Title Z-A, Date Added, Date Updated, Season Count) are on every library toolbar, persisted per library. Free-text title search. Sort order follows Plex/Sonarr semantics: manual `sorttitle` override → provider sort name → leading-article-stripped fallback. Date Added is recorded when the scanner first sees a folder (backfilled from folder mtime on upgrade); Date Updated tracks the newest mtime across the item folder and its season subfolders. Hitting back on a detail page restores the exact prior scroll position. (frontend LibraryView / App.)

#### Pruning
- **Prune missing** — forget tracked folders no longer on disk.
- **Prune empty** — forget tracked folders that exist but contain zero media files.
Each candidate is re-walked on the live filesystem immediately before deletion so a download landing between preview and confirm can't be pruned by accident. Neither action deletes files on disk (unless prune-empty is explicitly told to). (`POST /api/items/prune`, `/prune-empty`.)

#### Version chip, Plex refresh, logs, help
- A backend version chip in the top bar shows the running version; `GET /api/version` and Settings→About expose the same.
- Optional Plex integration: test connection, list sections, and trigger a partial rescan for a folder (with configurable path mappings and post-build auto-refresh). Plex is an integration target, not a metadata source. (`services/plex.py`.)
- Rotating `app.log` plus per-job logs under `<config>/logs/jobs/<job_id>.log`; a Logs view live-tails the last 400 lines.
- In-app Help view documents the workflow, buttons, and status legend.

### User flows

1. **First run / add library:** open the UI, enter the API token once (stored in the browser). Libraries auto-detect from the media root; the sidebar lists them, with a rescan link. Set preferred language and paste the TVDB key in Settings if not set via env.
2. **Browse:** pick a library → grid or list. Sort, apply status filter, search by title. Status badges show at a glance what needs work.
3. **Match → build:** open a show → if unbound, Manual match (search → Bind) or rely on folder-id/auto-match → Build NFOs (or Force rebuild). Watch progress in the Jobs tab.
4. **Refine:** on a bound item, use Overrides (fields + per-episode thumbnails), Artwork (per-slot picker), Episodes (per-file S/E mapping + rename), and Secondary source (pin the other provider's id).
5. **Rename:** Episodes tab → Rename to scheme → preview every `from → to`, pick series type/release group, apply the checked subset. Companions and mapping overrides follow the video.
6. **Bulk / danger:** library toolbar Auto-match all / Build all / Prune; Danger Zone at the bottom for library-wide sweep/wipe/blast, each dry-run-then-confirm.
7. **Automation:** enable the watcher (auto scan/match/build on new files, with a review queue for failures) and/or cron schedules.

### API surface

All routes are under prefix `/api`. **Every `/api/*` route requires the API token** — enforced globally by middleware, not per route (see Configuration → Security). Additionally the interactive docs (`/openapi.json`, `/docs`, `/docs/oauth2-redirect`, `/redoc`) require the token. `OPTIONS` (CORS preflight) bypasses the check. Missing/unset server token → **503**; missing/wrong client token → **401**. Body-validation failures → **422** automatically. Path parameters that must live under the media root are validated centrally and return **400** ("Path outside MEDIA_ROOT") on escape. Error bodies are `{"detail": ...}`.

Token is accepted (in order) from the `X-API-Token` header, `Authorization: Bearer <tok>`, or an `api_token` query parameter (the query param exists for `<img>`/`<a>` loads that can't set headers; it is redacted from access logs).

**Health / version / settings**
- `GET /api/health` → `{ok, version, media_root, tvdb_configured, tmdb_configured, fanart_configured, metadata_source, plex_configured, plex_auto_refresh}`.
- `GET /api/version` → `{version, name, repo}`.
- `GET /api/settings` → full settings with secret fields removed and replaced by `<field>_configured: bool`.
- `POST /api/settings` (body: any subset of settings; empty-string secrets mean "leave unchanged") → validates/normalizes (Plex delay clamped 0–600, url stripped, language lists deduped/lowercased, enums coerced), writes settings.json, reloads watcher if watcher knobs changed → `{ok:true}`.

**Browse**
- `GET /api/browse?path=` → `{path, parent, items:[{name,path,is_dir,size}]}`; **404** if missing. Read-only.

**Libraries**
- `POST /api/libraries/detect` → walks media root, upserts libraries, reloads watcher → `{libraries:[...]}`.
- `GET /api/libraries` → `{libraries:[{...row, effective_metadata_source}]}`.
- `POST /api/libraries/{name}` (body `{kind?, enabled?, metadata_source?}`) → updates row, reloads watcher on enable change → `{ok, library, effective_metadata_source}`.
- `DELETE /api/libraries/{name}` → **404** if unknown; deletes the library + all its DB rows (files untouched) → `{ok, items, bindings}`.
- `POST /api/libraries/{name}/scan` → schedules a background scan (walks disk, upserts item_state) → `{ok, scheduled:true}` immediately.

**Items / detail**
- `GET /api/items?library=&status=&q=&hide_organized=false` (status = comma list of nfo_status values) → `{items:[...item rows]}`. Read-only.
- `GET /api/items/detail?path=` → aggregate: binding, item_state, overrides, on-disk canonical artwork, a best-effort live provider episode count, tags, parent library kind. External calls, no writes.
- `GET /api/items/nfo-explain?path=` → per-season coverage + reasons. Read-only (Recompute re-walks disk).

**Custom tags**
- `POST /api/items/tags` (body `{folder_path, tag}`) → adds tag + rewrites sidecar.
- `DELETE /api/items/tags?folder_path=&tag=` → removes tag + rewrites sidecar.

**Danger zone / cleaner**
- `POST /api/items/clean` (body `{folder_path, dry_run=false, keep_sidecar=true, rescan=true}`) → dry-run preview list, else delete generated NFOs+artwork (media/season folders preserved, sidecar preserved unless `keep_sidecar=false`), optional rescan.
- `POST /api/items/remove` (body `{folder_path}`) → deletes item_state + related DB rows; no FS change.
- `POST /api/items/prune` (body `{library?, dry_run=false}`) → forget tracked folders missing on disk.
- `POST /api/items/prune-empty` (body `{library?, dry_run=false, delete_files=false}`) → forget folders with no media; with `delete_files=true` also cleans them. Re-checks live FS before each deletion.
- `POST /api/libraries/{name}/wipe-nfo` (body `{library, dry_run=false, keep_sidecar=true, rescan=true}`) → **400** on name mismatch; bulk clean across every tracked folder.
- `POST /api/libraries/{name}/wipe-sidecars` (body same) → delete every sidecar in the library.

**Orphan sweeper**
- `GET /api/items/orphans?path=` → preview of orphaned `<stem>.nfo`/`<stem>-thumb.*`; cached fast-path or disk walk; **404** if folder missing.
- `POST /api/items/orphans/sweep` (body `{folder_path, dry_run=false, rescan=true}`) → delete orphan companions.
- `POST /api/libraries/{name}/orphans/sweep` (body `{library, dry_run=false, rescan=true}`) → **400** on mismatch; library-wide sweep (skips folders with cached zero count).

**Matching / bindings**
- `GET /api/match/search?q=&type=series&year=&language=&provider=&library=` → `{results, provider}` (live provider search).
- `POST /api/match/bind` (body `{folder_path, kind, provider=tvdb, external_id, title?, year?, language?, lock_source=true}`) → **400** on bad provider; upsert binding, rescan, write sidecar.
- `POST /api/match/source` (body `{folder_path, provider, external_id?, locked=true, kind?, title?, year?}`) → switch provider (locks by default), rescan, write sidecar.
- `POST /api/match/secondary` (body `{folder_path, provider?, external_id?}`) → requires an existing primary; provider must differ and be tvdb/tmdb; set/clear secondary id, write sidecar.
- `POST /api/match/unbind?folder_path=` → delete binding, write sidecar.
- `POST /api/match/auto-bulk` (body `{folder_paths?, library?, only_unmatched=false, only_unbuilt=false, force=false, language?}`) → **400** if no target; skips source-locked; on match rescan + write sidecar → `{ok, total, matched, results}`.

**NFO field overrides**
- `GET /api/overrides?path=` → `{path, overrides}`.
- `POST /api/overrides` (body `{folder_path, scope, field, value?}`) → **400** if field not in {title,sorttitle,plot,tagline,originaltitle} or scope not matching `^(series|movie|season-\d{2}|episode-[A-Za-z0-9_\-]+)$`; write override, sync sort_title, write sidecar.
- `POST /api/overrides/clear` (body `{folder_path, scope?, field?}`) → clear, refresh sort_title, write sidecar.

**Build**
- `POST /api/build` (body `{folder_path, kind?, force=false, language?}`) → start a build job (writes NFOs/artwork in background) → `{ok, job:<id>}`.
- `POST /api/build/bulk` (body BulkIn as above) → **400** if no target; queue a job per folder → `{ok, queued, jobs:[...]}`.

**Jobs** (in-memory, not persisted)
- `GET /api/jobs` → `{jobs:[...]}` (200 most recent).
- `GET /api/jobs/{id}` → **404** if unknown; job dict `{id, kind, folder, status(running|completed|failed), progress, total, started_at, finished_at, messages}`.
- `GET /api/jobs/{id}/log` → per-job log as text/plain; **404** if absent.

**Artwork**
- `GET /api/artwork/file?path=` → FileResponse; **404** if not a file.
- `GET /api/artwork/candidates?path=&kind=series` → **400** if unbound; aggregated candidates per slot across providers.
- `POST /api/artwork/select` (body `{folder_path, slot, url, language?, score?}`) → write selection.
- `POST /api/artwork/clear` (body `{folder_path, slot?}`) → clear selections.
- `POST /api/artwork/upload` (multipart `folder_path, slot?, file`) → **400** empty/unsupported type, **413** if >50 MB; write image under config custom-artwork dir + DB row.
- `POST /api/artwork/custom-url` (body `{folder_path, url, slot?}`) → **400** if not http(s); register URL as custom (no download).
- `GET /api/artwork/custom/{art_id}` → serve uploaded file; **404**/**400** as applicable.
- `DELETE /api/artwork/custom/{art_id}` → delete on-disk file (if upload) + DB row.
- `GET /api/artwork/custom?folder_path=` → `{items:[...]}`.
- `GET /api/artwork/languages` → `{tvdb:[{code,name,native_name}], tmdb:[...]}` (empty when provider unconfigured/fails).

**Episodes (mapper / thumbnails)**
- `GET /api/episodes?path=` → **400** if not bound series, **502** on provider failure → `{path, provider, locals:[...], tvdb_episodes:[...]}`.
- `POST /api/episodes/override` (body `{folder_path, season, episode, tvdb_episode_id?}`, null clears) → write/clear + sync sidecar.
- `POST /api/episodes/override-file` (body `{folder_path, file_path, season?, episode?, external_id?, clear=false}`) → **400** if file not under folder; write/clear + sync sidecar.
- `GET /api/episodes/thumb-candidates?path=&season=&episode=` → **400**/**502**; TMDB stills grid or TVDB single + note.
- `POST /api/episodes/thumb-select` (body `{folder_path, external_id, url?}`) → write/clear slot `episode-thumb-<id>` + sync sidecar.

**Rename**
- `POST /api/episodes/rename/preview` (body `{folder_path, template?, daily_template?, anime_template?, series_type=auto, release_group?}`) → **400** unbound/disabled, **502** provider failure; dry-run only → items with `{src, dst, src_name, dst_name, season, episode, matched_title, conflict, unchanged}`.
- `POST /api/episodes/rename/apply` (body adds `only_src?`) → **400** unbound/disabled; rename files on disk (subset via `only_src`), sync sidecar if anything renamed.

**Logs**
- `GET /api/logs/app?tail=500` → `{lines:[...]}` (last N lines of app.log; empty if none).

**TVDB helpers / cache**
- `GET /api/tvdb/series/{id}` / `GET /api/tvdb/movie/{id}` → live extended payload.
- `POST /api/tvdb/cache/clear` → clears the whole cache table → `{cleared:N}`.

**Plex**
- `GET /api/plex/test` → identity + sections (external HTTP).
- `GET /api/plex/sections` → **400** unconfigured, **500** client init, **502** PlexError → `{sections}`.
- `POST /api/plex/refresh` (body `{path, delay_seconds?}`) → **400** if blank; delay clamped 0–600; trigger partial rescan.

**Schedules**
- `GET /api/schedules` → `{schedules}`.
- `POST /api/schedules` (body `{library?, cron, action, enabled=true}`) → **400** invalid action/cron; insert.
- `PATCH /api/schedules/{id}` (body `{library?, cron?, action?, enabled?}`) → **404**/**400**; update.
- `DELETE /api/schedules/{id}` → **404** if none deleted.
- `POST /api/schedules/{id}/run` → **404** if unknown; trigger run-now.

**Watcher**
- `GET /api/watcher/status` → `{available, enabled, running, debounce_seconds, watched_paths, pending_count, in_flight_count}`.
- `POST /api/watcher/toggle` (body `{enabled}`) → persist + reload → `{ok, status}`.
- `GET /api/watcher/events?limit=200` → in-memory ring buffer, newest first.
- `GET /api/watcher/review?library=` → review rows.
- `POST /api/watcher/review/resolve` (body `{folder_path}`) → delete one review row.
- `POST /api/watcher/review/retry` (body `{folder_path}`) → **400** if missing/outside root/library-root; re-arm the pipeline. **[See quirks — currently no-ops silently.]**
- `DELETE /api/watcher/review?library=` → clear the queue.

HTTP status codes used across the surface: **400, 404, 413, 422 (auto), 500, 502**, plus **401/503** from auth.

### Data model

The database is a working cache; the per-folder sidecar is the durable source of truth. A rebuild may pick any storage, but must preserve these entities, keys, and the sidecar-recovery invariant.

**Entities (current SQLite tables):**
- **libraries** — name (PK), kind (`tv|movies|mixed`), enabled, detected_at, metadata_source (null|tvdb|tmdb override).
- **bindings** — folder_path (PK), kind (series|movie), provider (tvdb|tmdb|imdb), external_id, title, year, language, source_locked, secondary_provider, secondary_external_id, created_at, updated_at. Invariants: secondary id must differ from primary and be tvdb/tmdb; source_locked blocks auto-match overwrite.
- **item_state** (scan cache / library list) — folder_path (PK), library, kind, title, year, external_id, provider, nfo_status, episode_count_local, episode_count_tvdb, season_count_local, last_scanned, last_built, poster_path, sort_title, orphan_count, date_added (insert-only), date_updated.
- **artwork_selections** — (folder_path, slot) PK, url, language, score, updated_at. Slots: `poster|background|banner|clearlogo|season-NN-poster|episode-thumb-<id>`.
- **active_artwork** — (folder_path, slot) PK, source_path, updated_at (records the on-disk file backing a slot).
- **episode_overrides** (legacy, by S/E) — (folder_path, season, episode) PK, tvdb_episode_id.
- **episode_file_overrides** (by file path) — (folder_path, file_path) PK, season, episode, external_id.
- **nfo_overrides** — (folder_path, scope, field) PK, value. scope ∈ series|season-NN|episode-<id>|movie; field ∈ title|sorttitle|plot|tagline|originaltitle. Empty value → row deleted.
- **custom_artwork** — id (PK, sha1), folder_path, slot, source (upload|url), origin, file_path, content_type, size, created_at.
- **custom_tags** — (folder_path, tag) PK, created_at. Case-insensitive dedupe.
- **schedules** — id (PK), library (null=all), cron (5-field UTC), action, enabled, last_run, last_status, last_message, created_at, updated_at.
- **watcher_review** — folder_path (PK), library, kind, reason (no_match|low_confidence|error|ambiguous), detail, detected_at, last_attempt_at, attempts.
- **tvdb_cache** — key (PK), payload (JSON), fetched_at, ttl. Generic HTTP response cache shared by TVDB/TMDB/fanart via key prefixes; expiry checked on read.

**Sidecar `.plex-nfo-builder.json`** (per bound folder, version 1):
```
{
  version: 1,
  binding: {kind, provider, external_id, title, year, language,
            source_locked, secondary_provider, secondary_external_id} | null,
  overrides: {scope: {field: value}},
  artwork_selections: {slot: {url, language, score}},
  episode_overrides: {"SS-EE": tvdb_episode_id},
  episode_file_overrides: {relpath: {season, episode, external_id}},   // keys relative to folder
  custom_tags: [str, ...]
}
```
**Invariant:** on a folder scan, if the folder has a sidecar but no DB binding, the entire sidecar is restored into the DB. This is what makes a DB wipe recoverable. Sidecar keys are relative paths so they survive folder moves.

**Sort title:** override wins; else strip a leading English article (`the `/`a `/`an `, case-insensitive); else the raw title.

### File-system and external effects

A rebuild must get these exactly right; these are the operations users depend on and the ones most dangerous to get wrong.

**Files created/written (next to media):**
- `<item>/tvshow.nfo`, `<season-dir>/season.nfo`, `<video-stem>.nfo` (episodes and movies). Movie fallback `<item>/movie.nfo` when no video is present.
- `<item>/poster.jpg`, `background.jpg`, `banner.jpg`, `clearlogo.png`.
- Season posters: `SeasonNN-poster.jpg` (zero-padded), `season-specials-poster.jpg` (season 0). (Legacy `Season00-poster.jpg` recognized for cleanup.)
- `<video-stem>-thumb.jpg` episode thumbnails.
- `<item>/.actors/<Actor Name>.jpg` (name sanitized: `<>:"|?*/\` and control chars → `_`, spaces/unicode kept; empty → `unknown`).
- `<item>/.plex-nfo-builder.json` sidecar (written at the end of every build and on every mutation route).
- Uploaded custom artwork under `<config>/custom-artwork/<sha1><ext>`.

**Provenance header** (first two lines of every generated NFO):
```
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!-- plex-nfo-builder version={ver} generated_at={unix} tvdb_id={id} content_hash=sha256:{hex} -->
```
`content_hash` is sha256 of the pretty-printed NFO body. The detection token is the literal `<!-- plex-nfo-builder`, checked within the first ~2000 chars.

**Atomicity (a hard requirement):** NFOs are written to a sibling temp file, flushed + fsync'd, then `os.replace`d into place. The sidecar is written the same way. Artwork downloads stream to a `.part` file then replace. Empty `<uniqueid>` tags are never written. Rationale: Plex must never observe a torn or ambiguous NFO.

**Renames/moves:** the renamer moves videos + companions (`.nfo`, `-thumb.*`, subtitle sidecars) via atomic replace, same-parent only (cross-folder refused), and migrates the corresponding `episode_file_overrides` row.

**Deletes:** the orphan sweeper unlinks orphaned `<stem>.nfo`/`<stem>-thumb.*`; the cleaner unlinks NFOs/artwork/thumbs (and the sidecar only when explicitly told). DB-row deletions never remove files. Videos, subtitles, audio, and season folders are never deleted.

**Read-only walks:** library detection, per-folder status scans, and "why partial?" explanations walk the tree read-only; an unreadable directory is treated as "has media" (conservative, so it is not pruned).

**External services:**
- **TVDB v4** (`https://api4.thetvdb.com/v4`): login (apikey + optional PIN) → bearer token, re-login after ~23h or on 401; search, `series/{id}/extended?meta=translations,episodes`, paginated episodes, `episodes/{id}/extended`, `movies/{id}/extended?meta=translations`, `series/{id}/artworks`, translations, `people/{id}`, `languages`. 3-attempt retry with backoff honoring `Retry-After`.
- **TMDB v3** (`https://api.themoviedb.org/3`, images `https://image.tmdb.org/t/p/{size}{path}`): api_key query param; `search/tv|movie`, `tv|movie/{id}?append_to_response=external_ids,credits,...`, season/episode images with `include_image_language`, `configuration/languages`.
- **fanart.tv v3** (`https://webservice.fanart.tv/v3`): api_key query param; `tv/{tvdb_id}`, `movies/{id}`; 404s cached briefly to avoid re-hammering.
- **Plex** (user-configured base URL, `X-Plex-Token`): identity, sections, partial/full section refresh, metadata refresh; path translation via longest-prefix mappings; never raises to the caller.
- All provider responses are cached in the shared cache table keyed by URL+query (default TTL 168h / 7 days); `force` bypasses read but still writes.

### Configuration

**Environment variables** (defaults in parentheses):

| Var | Default | Controls |
|---|---|---|
| `API_TOKEN` | _(unset)_ | Required. Whole-API access token; app is fail-closed (503 until set). |
| `CORS_ALLOW_ORIGINS` | `""` | Comma origin allowlist; empty = CORS off. Never wildcard. |
| `TRUSTED_HOSTS` | `""` | Comma `Host` allowlist (DNS-rebinding defense); empty = accept any. |
| `TVDB_API_KEY` | _(unset)_ | TVDB key (or set in Settings). |
| `TVDB_PIN` | _(unset)_ | Optional subscriber PIN. |
| `TMDB_API_KEY` | _(unset)_ | TMDB key. |
| `FANART_API_KEY` | _(unset)_ | fanart.tv key. |
| `MEDIA_ROOT` | `/media` | Each top-level dir becomes a library. |
| `CONFIG_DIR` | `/config` | DB / logs / settings.json / custom-artwork live here. |
| `LOG_LEVEL` | `INFO` | DEBUG/INFO/WARNING/ERROR. |
| `LISTEN_HOST` | `0.0.0.0` | Bind host. |
| `LISTEN_PORT` | `8000` | Bind port (container). |
| `TZ` | `America/Chicago` | Container time zone. |
| `WATCHER_ENABLED` | `true` | Watcher boot default. |
| `WATCHER_DEBOUNCE_SECONDS` | `30` | Boot debounce (clamped 1–3600). |
| `WATCHER_MAX_INFLIGHT` | `2` | Concurrent watcher pipelines. |
| `WATCHER_KILL_SWITCH` | _(unset)_ | Truthy forces watcher off. |

**Derived paths:** `settings.json`, `libraries.json`, `app.db`, `logs/`, `custom-artwork/` all under the config dir.

**User settings** (persisted to `settings.json`; UI-editable; override env for credentials): preferred_language (`eng`), fallback_languages (`[eng]`), include_original_title (true), cache_ttl_hours (168), overwrite_foreign_nfo (false), auto_match_threshold (85), metadata_source (`tvdb`), fanart_enabled (true), tmdb_artwork_enabled (true), preferred_artwork_source (`auto`), Plex (url/token/auto_refresh/refresh_delay 5/path_mappings), seven rename templates + rename_enabled (true), auto_sweep_orphans (true), per-provider artwork language whitelists + allow-null-language toggles, and nullable watcher_enabled/watcher_debounce_seconds (null = follow env). Credential precedence: user settings → env → process env. Metadata source precedence: per-library override → global → `tvdb`.

**Security model (must preserve):** the API mutates and deletes files, so it is fail-closed behind a single shared token; docs endpoints are gated too; the token query param is redacted from access logs; CORS is off by default (SPA is same-origin); an optional `Host` allowlist blunts DNS rebinding; a reverse proxy terminating TLS + real auth is the recommended deployment. There is no per-user auth, RBAC, or CSRF token — the token + same-origin + Host allowlist is the entire model.

### Behavioral quirks and edge cases

- **Fail-closed with no token:** every `/api` call (and the docs) returns 503 with an explanatory detail; the UI shows a "server has no API_TOKEN configured" screen distinct from a 401 "invalid token".
- **Image auth via query param:** `<img>` and `<a>` loads can't set headers, so they carry `api_token=` in the URL; this is redacted from logs. Any new image loader in a rebuild must go through the same mechanism.
- **Sidecar restore only when DB is empty for that folder:** a folder with both a sidecar and a DB binding is not re-restored; a stale sidecar can therefore resurrect old state after a DB wipe.
- **`stale` status is declared but never produced** by the current classifier (the provenance hash is written but never diffed against disk). Cross-referenced in Layer 3 (Missing features) — the rebuild should decide whether to implement staleness or drop the value.
- **Root-video (anime/OVA) layouts:** shows with videos at the show root (no season dirs) are supported for matching/parsing, but the orphan sweeper and scanner mishandle `tvshow.nfo` in this layout. **This is a bug — see Layer 3 (Reliability), which cross-references the "orphan sweeper never touches tvshow.nfo" contract above.**
- **TVDB movie cast is thin:** TVDB-bound movies emit only whatever `characters` the movie record returned (often just crew), with no character-type filter. **Bug — see Layer 3.**
- **Anime numbering:** `[Group] Title - 03` is treated as S01E03 by default; a per-file picker allows a different season when a fansub bundles multiple seasons.
- **Daily shows:** an isolated air-date filename (`Show - 2024-01-15`) is parsed as a daily episode; the builder resolves real S/E from the provider later.
- **Unparsed files** are counted toward the local file total but skipped by the builder until mapped.
- **Prune re-checks live disk** immediately before each deletion so a download landing between preview and confirm is never pruned.
- **Cron:** 5-field UTC, POSIX DOM/DOW "either matches when both restricted" semantics; day-of-week 7 is currently rejected as Sunday (bug — Layer 3).
- **Concurrent scans/writes:** a single shared DB connection under a lock serializes all DB access; settings.json is read-modify-write with no lock (bug — Layer 3).
- **Jobs are ephemeral:** build jobs live only in memory and are lost on restart; only their log files persist.

---

## Layer 2: Current implementation

**This layer describes the existing code for reference. It is not a design for the rebuild. Do not reproduce its structure, dependencies, or patterns unless layer 3 says to keep them.**

### Stack and dependencies

- **Backend:** Python 3.12, FastAPI + Starlette, uvicorn, pydantic / pydantic-settings, httpx (async), rapidfuzz (fuzzy match), watchdog (filesystem watcher), loguru (logging), stdlib `sqlite3`, stdlib `xml.etree` + `minidom` (NFO rendering), `subprocess` → `ffprobe` (MediaInfo). `lxml` is declared but unused.
- **Frontend:** React 18 + TypeScript, Vite 5, Tailwind 3 (empty theme config), `@tanstack/react-query` 5. No router library — a hand-rolled `history.pushState` router. Frontend package version 0.13.2.
- **Container:** multi-stage Dockerfile — stage 1 builds the SPA on `node:20-alpine` pinned to the build platform; stage 2 is `python:3.12-slim` with `tini`, `ca-certificates`, and `ffmpeg` (for ffprobe), serving the built SPA from `/app/static`. Runs as root (no `USER`).

### Repository layout

- `backend/app/main.py` — app singleton, middleware, token auth, SPA static serving + fallback, lifespan startup (background library detection → watcher start; scheduler start).
- `backend/app/config.py` — `EnvSettings` (env) + `UserSettings` (settings.json) + derived paths + credential/source resolvers.
- `backend/app/db.py` — single shared `sqlite3` connection (WAL, autocommit, `foreign_keys=ON`) under an `RLock`; idempotent schema init + additive `ALTER TABLE` migrations (not versioned); all query helpers.
- `backend/app/routes/api.py` — one ~3,120-line `APIRouter(prefix="/api")` holding every endpoint plus significant business logic and some raw SQL.
- `backend/app/services/` — `scanner`, `builder`, `nfo`, `sidecar`, `orphans`, `cleaner`, `matcher`, `parser`, `renamer`, `mediainfo`, `artwork`, `artwork_resolver`, `fanart`, `tmdb`, `tvdb`, `plex`, `scheduler`, `watcher`.
- `backend/app/logging_setup.py` — loguru sinks (stdout + rotating `app.log` 10 MB × 10 gzip), access-log token redaction, per-job log sinks.
- `frontend/src/` — hand-rolled router in `App.tsx`; `lib/api.ts` (~861-line API client), `lib/auth.ts` (token storage + `authFetch` + `mediaUrl`); components (AuthGate, Sidebar, Topbar, ConfirmDialog); views (Library, Detail, EpisodeMapper, OverridesTab, ArtworkPicker, Settings, Watcher, Jobs, Logs, Help).
- CI/deploy: `.github/workflows/ci.yml` (backend ruff+mypy+pytest, frontend tsc+eslint), `docker-publish.yml` (GHCR multi-arch), `release.yml`.

### Data flow

Request → token middleware → route handler in `api.py` → service call → shared SQLite connection and/or disk + provider HTTP (httpx, cached in the DB) → sidecar write. Builds are dispatched as in-memory `asyncio` tasks tracked in a module-level `_jobs` dict, each also writing a per-job log file. The watcher and scheduler are module singletons started in the app lifespan; the watcher uses `watchdog.Observer`, the scheduler an asyncio minute-tick loop with a custom cron parser. Provider clients (`tvdb.py`, `tmdb.py`, `fanart.py`) share the `tvdb_cache` table via prefixed keys.

### Key algorithms and mechanisms

- **Status bucketing:** a single walk per season dir counts episode NFOs, foreign NFOs (no provenance), and orphans; buckets into none/partial/complete/foreign/mixed by comparing NFO count to expected episode count and provenance presence. Duplicated between the scanner and the "why partial?" explainer.
- **Matching:** folder-id shortcut → early bind; else rapidfuzz `token_set_ratio` with +15 (exact year) / +5 (off-by-one) bonuses, capped at 100, rejected below threshold (default 85); TMDB adds a small popularity tiebreak; year-fallback retries without year on weak/empty hits.
- **Filename parsing:** regex precedence SxxExx → anime `[Group] Title - NN` (defaults season 1) → daily air-date → unparsed; season dirs detected by name prefix; folder-looks-like-movie heuristic.
- **Renamer:** a hand-written Sonarr/Radarr template grammar (plain tokens, zero-pad, `{[...]}` conditional groups with separators, `[{Token}suffix]`, prefix-conditional `{-Token}`, nested `{tvdb-{TvdbId}}`), token-alias map, sanitization, per-file template selection in auto mode, conflict detection, and companion-file migration via `os.replace`.
- **MediaInfo:** `ffprobe -show_streams -show_format` JSON, cached by `(path, mtime)`, mapped to codec/bit-depth/HDR/audio/channels/languages/quality/release-group.
- **Artwork:** provider-specific type-id maps, `(language-rank, -score)` ranking, per-provider language filters with unfiltered fallback, a cross-provider resolver (TVDB↔TMDB id crosswalk, or the pinned secondary id), and actor-portrait downloaders.
- **Provenance:** NFO rendered via minidom pretty-print, sha256 of the body embedded in the header comment; detection by literal token prefix in the first ~2 KB.

### Deployment and CI

- **Dockerfile:** two stages as above; env `MEDIA_ROOT=/media`, `CONFIG_DIR=/config`; volumes `/media`, `/config`; expose 8000; entrypoint `tini`, CMD uvicorn.
- **docker-compose.yml:** one service, image `ghcr.io/cooper8386/plex-nfo-builder:latest`, port `8765:8000`, `API_TOKEN` required (compose refuses to start unset), media + `./config` volumes, `restart: unless-stopped`.
- **CI (`ci.yml`):** on push/PR to main — backend job (ruff, mypy, pytest on 3.12) and frontend job (tsc, eslint on Node 20).
- **Publish (`docker-publish.yml`):** QEMU + Buildx multi-arch (amd64/arm64) to GHCR with semver/branch/edge/latest tags.
- **Release (`release.yml`):** on `v*` tags, generates notes from git log and publishes a GitHub release.

---

## Layer 3: Shortcomings

Sources tagged `[user]` (owner interview, 2026-08-30), `[review: codebase-review-2026-08-26.md]` (prior full review, v0.13.2), `[code: path]` (verified in code during this spec). Findings prefixed `C#/H#/M#/L#` reference the review's IDs.

### Performance

- **Blocking synchronous FS / `ffprobe` I/O runs on the async event loop** in builder, renamer, scheduler, and several routes; only the watcher was moved off-loop. On a slow share this pins the loop and stalls every request — the app "feels sluggish" and navigation/builds/scan/image loads all lag. `[user][review: H5]`
- **`watcher.reload()` joins the observer for up to ~5s from async handlers** (every settings save / library toggle can stall all traffic). `[review: M22]`
- **settings.json is re-read and re-validated on every call**, including inside event-loop callbacks and per artwork pick. `[review: M21]`
- **Startup date-backfill `stat()`s every item folder synchronously at import**, before the ASGI server binds; on a cold/slow SMB/NFS mount this blocks startup. This is the leading **candidate cause of "the app sometimes just doesn't load, and restarting the container doesn't fix it"** — a hung/slow mount stalls import-time work before the server can answer. `[user][review: L16]` — root cause `[unverified]` (not reproduced; also consistent with a wedged watcher or provider call at boot).
- **No pagination:** the library list materializes up to 5000 rows per poll and the SPA re-serializes the whole library each time; `/jobs` similarly. `[review: L14]`
- **A new httpx client is built/torn down per image download** (no connection pooling) — dozens per build. `[review: L15]`
- **Unbounded in-memory growth:** the `_jobs` dict and the mediainfo `(path, mtime)` cache are never evicted. `[review: M18]`

### Reliability and bugs

- **Orphan sweeper deletes `tvshow.nfo` for root-video (anime/OVA) layouts.** The sweep runs after every build (auto_sweep_orphans defaults on); for a show with videos at the root, the build writes `tvshow.nfo` then the sweep immediately deletes it, so the show can never reach `complete`, and the count path double-counts it. **This directly matches the user report: "shows appear in Plex with no artwork or NFO files, but the app says completed."** Contradicts the Layer 1 orphan-sweep contract (`tvshow.nfo` "always preserved"). `[user][review: H6][code: orphans.py, scanner.py]`
- **Cast/crew wrong in Plex for TVDB-bound MOVIES (shows ~2 people, not the main cast).** Root cause verified: the TVDB movie fetch requests `movies/{id}/extended` with `meta=translations` only (no cast/people expansion) `[code: services/tvdb.py:201-208]`, so the `characters` array is sparse and often just crew (Director/Writer); the movie NFO builder emits every entry verbatim as `<actor>` with no character-`type` filter and no dedupe (it only drops entries missing a person name) `[code: services/nfo.py:333-343]`; the thumb hydrator backfills portraits but never expands the cast count `[code: services/builder.py:136-221]`. The TMDB movie path is healthy (reads `credits.cast`, keeps billing order, caps at 30) `[code: services/nfo.py:523-533, services/tmdb.py:406-412]`, so the symptom is TVDB-movie-specific. **[user]** report; **[code]** root cause. Fix direction: fetch real cast for TVDB movies (a people/cast-bearing endpoint) or prefer TMDB `credits.cast` for cast even on TVDB-bound movies, and filter by character type so crew isn't emitted as `<actor>`.
- **Watcher auto-build hand-off is broken:** the watcher calls `start_build(folder, kind, False)` positionally into a keyword-only `force` param, and even if fixed, `start_build` uses `create_task` inside a `to_thread` worker (no running loop). Both errors are swallowed and logged as "Build queue failed", so the watcher detects → matches → **never builds**, and review-retry does nothing. `[review: H4][code: watcher.py:696]`
- **`download_series_canonical` ignores its `preferred_overrides` argument**, so with `preferred_artwork_source=tmdb` on a TVDB-bound show the NFO embeds TMDB URLs while the on-disk `poster.jpg`/`background.jpg` stay TVDB art — on-disk artwork silently disagrees with the setting and the NFO. Contributes to **artwork gaps / mismatches** the user sees. `[user][review: M26]`
- **Status bucketing is duplicated and has diverged** between the library list and the "why partial?" popover (e.g. foreign `tvshow.nfo` + all-foreign episodes buckets `foreign` in one place, `mixed` in the other), and the explainer never scans root-level episode NFOs, so a fully-built root-layout show explains as "partial". Undermines **status clarity**. `[user][review: M24]`
- **Wipe/clean doesn't match its own contract:** it never removes the `.actors/` directory, its dry-run never lists the sidecar even when it will be deleted, and root artwork matching is case-sensitive (`Poster.jpg` survives). `[review: M25]`
- **Destructive dry-run and execute can diverge:** execute re-runs the scan rather than acting on the previewed set, so the confirmed file list and the deleted set can differ. `[review: M15]`
- **Broken rename token `{Series TitleThe}` renders empty** (mixed-case key can never match the lowercased lookup, and the context key is absent). `[review: M27]`
- **Cron rejects `7` as Sunday** (POSIX accepts 0–7). `[review: L24]`
- **Case-only renames flagged as conflicts on Windows/SMB** (the stated target env), so a template fixing only capitalization is skipped. `[review: L25]`
- **Path-boundary check for episode-file overrides uses a string prefix**, so a sibling `…/Show 2/ep.mkv` passes the check for folder `…/Show` (mis-attributed override row). `[review: L1]`

### Interface

- **The user wants a full UX/UI redesign** — the UI "feels clunky and cobbled together." The spec keeps the rebuild's frontend stack open, but the owner's preferred and recommended approach is a from-scratch redesign driven by their `/frontend-design` skill with a strong model (e.g. fable). `[user]`
- **Error states are never rendered:** failed queries hang on "Loading…" or show empty data with no retry (Detail, Library, Sidebar, Watcher, Jobs, Logs). `[user][review: H1]`
- **ConfirmDialog auto-focuses the destructive Confirm button** (a stray Enter executes "Wipe ALL NFOs"/"Blast sidecars"), and a second dialog opened while one is pending never resolves (caller stuck busy forever). No focus trap. **Too many destructive buttons + risky confirm UX.** `[user][review: H2]`
- **Settings is one blob POSTed whole (last-writer-wins);** dirty tracking covers only the 5 secret fields, so editing templates/path-mappings shows no unsaved indicator and navigating away silently discards them. `[review: H3]`
- **No design tokens / empty Tailwind config, no shared primitives, dark-only, non-responsive** (fixed-width rails, non-wrapping topbar overflowing below ~900px, no table scroll wrappers). This is the redesign's foundation. `[user][review: M11]`
- **Hand-rolled router with view state scattered across URL, localStorage, and component state;** unknown paths silently render home (no 404); most secondary state isn't linkable. `[review: M3]`
- **Accessibility gaps** across custom menus/modals/badges (no Escape/aria/focus management; color-only status; low-contrast micro-text; keyboard-invisible hover-only controls). `[review: M6]`
- **Status is unclear** ("why partial" diverges and misses root layouts; color-only badges). `[user][review: M24]`
- **Library search fires one request per keystroke** (no debounce), and the term persists across library/view switches. `[review: M14]`
- **Stale selection lets users act on invisible items** (select-all, change filter, remove still removes the now-hidden set). `[review: M13]`
- **No top-level error boundary:** any render throw whitescreens the SPA. `[review: M5]`

### Features that work poorly or intermittently

- **Watcher** (detects/matches but never builds — H4).
- **Artwork gaps / blank posters** on foreign titles, and on-disk-vs-NFO artwork mismatch (M26); the language-filter fallback helps but the preferred-source override is dropped for series. `[user][review]`
- **Orphan sweep correctness** for root-video layouts (H6).

### Missing features

- **Durable job state** — builds are in-memory and lost on restart; a rebuild should persist jobs.
- **A build queue with bounded concurrency** — bulk/scheduled builds `create_task` per folder, so "Build all" on a large library launches hundreds of concurrent builds → provider 429s, memory spikes, loop saturation. `[review: M20]`
- **Real staleness detection** — `stale` status is declared but never computed (the content hash is written but never diffed).
- **Multi-user / RBAC / CSRF** — the security model is a single shared token only.
- **SSRF hardening** — Plex URL and build-time artwork URLs are fetched server-side with no private/loopback/metadata-range blocking (behind the token, but worth closing). `[review: M1, M2]`

### Code quality and structure

- **`routes/api.py` is a ~3,120-line catch-all** carrying business logic and raw SQL in routes; should be split by domain with aggregation pushed into services. `[review: M16]`
- **TVDB and TMDB pipelines are near-duplicate** (four parallel build functions, mirrored self-heal blocks, duplicated downloaders); every provider-agnostic fix must land in 2–4 places, and the git log shows repeated "TMDB parity" catch-up releases. Normalize provider payloads to one internal shape. `[review: M17]` — this duplication is also the structural reason the TVDB-movie cast bug above didn't get the TMDB path's fix.
- **Sidecar/DB dual-write is convention-only** — every mutation route must individually remember to write the sidecar; a crash between the two leaves a stale sidecar that resurrects on restore. Centralize into one persist step. `[review: M23]`
- **settings.json write is non-atomic** (bare write, unlike NFO/sidecar) and a corrupt file silently resets all settings with no log line. `[review: M21, L20]`
- **Triplicated `_detect_kind`** with subtly different logic across api/watcher/scheduler. `[review: L17]`
- **Incomplete per-folder row cleanup** (delete paths miss some tables) and an unbounded `IN (...)` clause that errors past SQLite's variable limit on very large libraries. `[review: L12]`
- **Dead code** (no-op `must_exist` branch, an always-true schedule-library block that makes "all libraries" unreachable via update, unused helpers). `[review: L18]`
- **Documentation drift** (README says `x264/x265`, code emits `h264/h265`; wipe "deletes every generated file" but skips `.actors/`). `[review: L21]`

### Testing and tooling

- A **pytest scaffold + lint/type gates were added after the review** (114 backend unit tests; ruff/mypy in the backend CI job; tsc/eslint in the frontend job). Baselines are deliberately lenient and latent bugs found while adding the net are tracked as issues, not fixed under the gate. The review's H7 ("zero tests/CI") is therefore **largely resolved** at this commit. `[review: H7]`
- Gaps remain: the frontend has **no runtime error boundary and no component/integration tests** beyond typecheck+lint `[review: M5]`; the specific data-loss bugs above (H6, H4, M24, M27) are exactly the logic a fuller unit suite would catch and are still open.

### Note: review findings already resolved since 2026-08-26

Record so the rebuild doesn't re-solve them (they are fixed in the current tree at dd910e5):
- **C1** — unauthenticated path-traversal file read via the SPA fallback — fixed (containment check added, commit c1b6d3d).
- **C2** — no auth + wildcard CORS on destructive endpoints — fixed in v0.14.0 (commit 690885f): fail-closed `API_TOKEN`, CORS off by default, optional `Host` allowlist, docs gated, token redacted from logs.
- **H7** — no tests/lint/typecheck — largely fixed (PR #4 phases).
Most H4/H5/H6 and the M/L items above **remain open**.

### Rebuild goals

Testable statements the planner turns into requirements:

1. Scans and navigation on a 10k-file library over a network share never block the API event loop; the UI stays responsive during a full-library build.
2. A build that reports `complete` always leaves a readable `tvshow.nfo` and its artwork on disk for **every** layout, including videos at the show root — verified by a root-video regression test.
3. The filesystem watcher reliably auto-builds after a successful match, and review-retry actually re-runs the pipeline — verified by a watcher regression test.
4. Cast and crew render fully and correctly in Plex for both TVDB- and TMDB-bound movies and series; crew is never emitted as `<actor>`.
5. On-disk artwork always agrees with the NFO and the `preferred_artwork_source` setting.
6. No destructive operation runs without an explicit confirm, and it executes against exactly the previewed set; danger confirms never default-focus the destructive action.
7. Every async request survives a slow or hung mount (startup binds the server before touching the share; blocking I/O is off-loop).
8. Failed queries show an error with retry, never an infinite spinner; a render error never whitescreens the app.
9. The UI is responsive, tokenized/themeable, accessible, and built from shared primitives, with linkable view state.
10. Settings edits are field-level, show unsaved state, and are never silently lost or clobbered; settings persistence is atomic and corruption is surfaced, not swallowed.
11. Build jobs are durable across restart and run through a single queue with bounded concurrency (no provider 429 storms).
12. Item status is computed by one shared function used everywhere, consistent between the library list and the "why partial?" explanation.

---

## Coverage

**Fully read:** all backend services (`scanner, builder, nfo, sidecar, orphans, cleaner, matcher, parser, renamer, mediainfo, artwork, artwork_resolver, fanart, tmdb, tvdb, plex, scheduler, watcher`), `main.py`, `config.py`, `db.py`, `logging_setup.py`, the full `routes/api.py` endpoint surface; all frontend views/components/`lib`; Dockerfile, docker-compose.yml, `.env.example`, all three GitHub workflows; README.md, CHANGELOG.md; and the prior review artifact `codebase-review-2026-08-26.md`. The TVDB-movie cast bug was confirmed by a targeted deep-read.

**Not run:** pytest / ruff / mypy / eslint were not executed for this spec (produced in plan mode). Their configuration is captured from `ci.yml`; the prior review recorded that no checks could execute at v0.13.2 (finding H7), which has since been addressed.

**`[unverified]`:** the root cause of "the app sometimes doesn't load and a container restart doesn't fix it" — the leading hypothesis is import-time synchronous folder `stat()`ing / provider or watcher work blocking before the server binds on a cold/slow mount (review L16), but it was not reproduced. The cast/crew root cause, by contrast, is now verified in code.
