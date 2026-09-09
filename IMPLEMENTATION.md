# Milestone 1 checkpoint

Scope: [issue #1, phases 1–9](https://github.com/Cooper8386/plex-nfo-builder-v2/issues/1). Reference: root `REPO_SPEC.md`; old repository read only for settings defaults, normalization, and API response shapes. No application media was modified.

| Phase | Version | Implementation |
| --- | --- | --- |
| 1 | 0.1.0 | pnpm workspace, Fastify app/listener, fail-closed auth, health, React placeholder, strict TypeScript, ESLint, Vitest, non-root Docker skeleton |
| 2 | 0.2.0 | Four isolated media layouts, cleanup helper, TVDB/TMDB/fanart HTTP doubles with 429 and hanging modes |
| 3 | 0.3.0 | Dry-run reset CLI, explicit confirmation, conservative filename matching, symlink protection, captured-list execution |
| 4 | 0.4.0 | All 13 schema entities, WAL and additive migrations, binding constraints, provider cache, atomic v2 sidecars, full recovery hook |
| 5 | 0.5.0 | Environment/default resolution, cached settings, serialized partial saves, normalization, secret handling, visible corruption errors |
| 6 | 0.6.0 | Shared core API types, package exports and consumer wiring, compile-time contract assertions |
| 7 | 0.7.0 | Durable job queue, bounded process workers, isolated SQLite ownership, restart recovery and job logs |

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
