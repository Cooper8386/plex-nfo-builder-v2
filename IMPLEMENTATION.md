# Milestone 1 checkpoint

Scope: [issue #1, phases 1–11](https://github.com/Cooper8386/plex-nfo-builder-v2/issues/1). Reference: root `REPO_SPEC.md`; old repository read only for settings defaults, normalization, and API response shapes. No application media was modified. Current checkpoint: phases 1–11 complete, version 0.11.0; phase 12 is next. Each phase from 6 onward has its own local main commit; issue #1 records exact SHAs and push state. Earlier phase notes below are historical validation records.

| Phase | Version | Implementation |
| --- | --- | --- |
| 1 | 0.1.0 | pnpm workspace, Fastify app/listener, fail-closed auth, health, React placeholder, strict TypeScript, ESLint, Vitest, non-root Docker skeleton |
| 2 | 0.2.0 | Four isolated media layouts, cleanup helper, TVDB/TMDB/fanart HTTP doubles with 429 and hanging modes |
| 3 | 0.3.0 | Dry-run reset CLI, explicit confirmation, conservative filename matching, symlink protection, captured-list execution |
| 4 | 0.4.0 | All 13 schema entities, WAL and additive migrations, binding constraints, provider cache, atomic v2 sidecars, full recovery hook |
| 5 | 0.5.0 | Environment/default resolution, cached settings, serialized partial saves, normalization, secret handling, visible corruption errors |
| 6 | 0.6.0 | Shared core API types, package exports and consumer wiring, compile-time contract assertions |
| 7 | 0.7.0 | Durable job queue, bounded process workers, isolated SQLite ownership, restart recovery and job logs |
| 8 | 0.8.0 | Library detection/settings, off-loop scans, shared status classifier, dates and read endpoints |
| 9 | 0.9.0 | Filename parser, movie heuristic, worker-owned ffprobe extraction and path/mtime cache |
| 10 | 0.10.0 | Normalized provider clients, pooled HTTP, retries/cache, SSRF protection and Plex path translation |
| 11 | 0.11.0 | Direct-ID/fuzzy matcher, source locks and secondary IDs, sidecar persistence and match endpoints |

ESLint uses its current flat configuration (`eslint.config.js`) instead of the plan's legacy `.eslintrc.cjs`. The generic provider cache is named `provider_cache`. Seven rename defaults were read from the authorized old-app reference; template execution remains phase 17.

Phase 7 adds a durable SQLite job queue, a bounded process worker pool, independent pools for control and media work, restart recovery, timeouts, and per-job logs. Interrupted jobs become failed with an explicit retry message; queued jobs resume. SQLite queue operations run only in the database worker. Scanner wiring is phase 8; builders and queue-triggering watcher/scheduler work remain later phases. The worker runtime only loads application-owned module URLs, never API-supplied code.

Phase 1–5 validation on 2026-09-09:

- `pnpm install`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` pass.
- Windows suite: 44 tests pass, one POSIX permissions test is skipped; two consecutive runs pass and sandbox cleanup is asserted.
- Non-root Linux container suite: all 45 tests pass, including the unreadable-directory test.
- `docker build -t plex-nfo-builder .` succeeds. The production entry point runs as UID 1000 and answers health with 200 for a valid token and 401 without a token.
- Auth tests cover fail-closed 503, header/Bearer/query precedence, docs gating, log redaction, host/CORS allowlists, and listener responsiveness during unfinished startup.
- Reset tests cover all four layouts, unchanged dry-run, exact candidate execution, retained media, changed/new files, and junction replacement.

The Windows Codex sandbox account cannot run tsx's account lookup in a child process (`uv_os_get_passwd`); the full suite was verified under the normal Windows account and in Docker. Lint, typecheck, and builds also pass in the sandbox.

Phase 6 validation on 2026-09-09: `pnpm --filter shared build`, `pnpm --filter shared typecheck`, and `pnpm --filter shared test` pass (six contract tests, with TypeScript assertions checked). Workspace lint, typecheck, and build pass; the Windows full suite reports 50 passed and one POSIX-only skip. The shared package uses only type exports, with no added runtime dependencies. Endpoint-specific contracts can extend this package in their implementation phases.

Preflight confirmed phases 1–5 checked off and their recorded commit `f2a722c6dd6578cc29499760c4208bb2d9f29024` in history. Source spot checks matched the issue. The user-authorized policy commit `f9abd03bf67b5e4b0ae6a613660af472df51bd3d` restored a clean `main` before phase 6 began. Phase 6 is a separate commit. Issue #1 records its exact SHA and latest working-tree/push state; phase 7 was deferred until the subsequent user request. The existing session handoff comment is updated rather than duplicated.

The user's standing checkpoint-update instruction is saved in `AGENTS.md`: after a phase or phase group completes and the build passes, update the issue body and add a nonduplicated session handoff comment, explicitly recording dirty state and actual commit SHAs or their absence.

Phase 7 acceptance: `pnpm --filter server test queue` and `pnpm --filter server test off-loop` pass, including 200 provider tasks capped at three workers and a blocked worker with a responsive health handler. Workspace typecheck, lint, and build pass. Phase 8 is next. The phase commit and push state are recorded in issue #1.

Phase 8 (0.8.0): Library detection, manual settings with live effective-provider resolution, off-loop scanning and sidecar recovery, a single status classifier, insert-only Date Added, latest-folder Date Updated, and the listed library/item endpoints are implemented. Status (6 tests) and scanner (7 tests including status) acceptance pass. Concurrent fresh database opens are protected by an immediate migration transaction. Workspace lint, typecheck, and build pass. Phase 9 is next; issue #1 records commits and push state.

Phase 9 (0.9.0): Filename parsing implements standard/multi-episode, anime, daily and unparsed precedence, folder/movie IDs and movie-folder detection. MediaInfo extracts codec, bit depth, HDR/DV, audio variants, channels, languages, quality and release group. A dedicated worker owns ffprobe and its bounded path/mtime cache; missing or unreadable media returns filename fallbacks. Parser and mediainfo acceptance pass, as do workspace typecheck, lint and build. No matching or renaming was added. Phase 10 is next.

Phase 10 (0.10.0): TVDB, TMDB, fanart and Plex clients are implemented. Provider data shares normalized metadata/cast/episode/season/artwork shapes; TVDB movies use TMDB cast when a cross-reference or pinned secondary ID resolves. A single native HTTP transport pools connections, pins validated DNS answers, validates redirects, retries up to three times with Retry-After, and uses the SQLite provider cache (168 hours by default; force bypasses reads but writes). Fanart 404s cache for one hour. Plex translates the longest matching path prefix and reports failure without throwing. Private and loopback Plex URLs are blocked as issue #1 explicitly requires. Clients must be constructed in workers because the cache owns synchronous SQLite access. Canned-response acceptance, typecheck, lint and build pass; no live credentials used. Cast filtering and artwork selection remain phases 13 and 14. Phase 11 is next.

Phase 11 (0.11.0): Direct folder IDs and movie filename TMDB IDs bind without search. Fuzzy token-set title/year matching uses the configured threshold with a year-free fallback for weak results. Manual bind/unbind, source switch/lock, secondary ID set/clear, effective provider resolution and bulk matching are exposed through typed routes. Locked bindings resist forced bulk matching. Each binding mutation atomically writes the sidecar before changing the database; a failed write leaves the prior database binding intact. Mutations are serialized in one worker, and bulk matching rescans each changed library once. Source updates without an explicit ID reuse the existing ID, matching the reference API; callers should send the target provider ID when switching providers. IMDb identity has no search client and falls back to the library/global metadata provider. No NFO building was added.

Final phase 11 validation: matcher acceptance passes; full Windows suite reports 72 passed and one POSIX-only permission skip; six shared contract tests pass with TypeScript assertions. Workspace lint, typecheck and build pass. Stop at phase 11; phase 12 has not started. No push was performed for phases 6–11.
