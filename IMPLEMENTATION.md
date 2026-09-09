# Milestone 1 checkpoint

Scope: [issue #1, phases 1–5](https://github.com/Cooper8386/plex-nfo-builder-v2/issues/1). Reference: root `REPO_SPEC.md`; old repository read only for settings defaults and normalization. No application media was modified.

| Phase | Version | Implementation |
| --- | --- | --- |
| 1 | 0.1.0 | pnpm workspace, Fastify app/listener, fail-closed auth, health, React placeholder, strict TypeScript, ESLint, Vitest, non-root Docker skeleton |
| 2 | 0.2.0 | Four isolated media layouts, cleanup helper, TVDB/TMDB/fanart HTTP doubles with 429 and hanging modes |
| 3 | 0.3.0 | Dry-run reset CLI, explicit confirmation, conservative filename matching, symlink protection, captured-list execution |
| 4 | 0.4.0 | All 13 schema entities, WAL and additive migrations, binding constraints, provider cache, atomic v2 sidecars, full recovery hook |
| 5 | 0.5.0 | Environment/default resolution, cached settings, serialized partial saves, normalization, secret handling, visible corruption errors |

ESLint uses its current flat configuration (`eslint.config.js`) instead of the plan's legacy `.eslintrc.cjs`. The generic provider cache is named `provider_cache`. Seven rename defaults were read from the authorized old-app reference; template execution remains phase 17.

Phase 6 is next: shared API contract types. Scanner wiring (phase 8), queue and off-loop database ownership (phase 7), settings routes, and the application UI are intentionally outside this checkpoint. Startup binds before loading local settings and never accesses the media root.

Validation on 2026-09-09:

- `pnpm install`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` pass.
- Windows suite: 44 tests pass, one POSIX permissions test is skipped; two consecutive runs pass and sandbox cleanup is asserted.
- Non-root Linux container suite: all 45 tests pass, including the unreadable-directory test.
- `docker build -t plex-nfo-builder .` succeeds. The production entry point runs as UID 1000 and answers health with 200 for a valid token and 401 without a token.
- Auth tests cover fail-closed 503, header/Bearer/query precedence, docs gating, log redaction, host/CORS allowlists, and listener responsiveness during unfinished startup.
- Reset tests cover all four layouts, unchanged dry-run, exact candidate execution, retained media, changed/new files, and junction replacement.

The Windows Codex sandbox account cannot run tsx's account lookup in a child process (`uv_os_get_passwd`); the full suite was verified under the normal Windows account and in Docker. Lint, typecheck, and builds also pass in the sandbox.

Phases 1–5 are included together in the initial implementation commit on `main`. Issue #1 records the commit SHA and latest working-tree/push state, marks phases 1–5 complete, identifies phase 6 as next, and records deviations and validation. The session handoff comment was added on 2026-09-09 and is updated when the checkpoint is committed and pushed.

The user's standing checkpoint-update instruction is saved in `AGENTS.md`: after a phase or phase group completes and the build passes, update the issue body and add a nonduplicated session handoff comment, explicitly recording dirty state and actual commit SHAs or their absence.
