# Plan tracking

The implementation plan is issue #1 in `Cooper8386/plex-nfo-builder-v2`. Use root `REPO_SPEC.md` and the issue's decisions and phase acceptance criteria.

After completing a phase or group of phases, once the build passes, update the GitHub issue body: check completed phases, record actual commit SHAs, update Status, and amend phases whose plans changed. If no commit exists, explicitly record that the SHA is unavailable; do not invent one. Always report a dirty working tree as dirty.

Inspect existing comments before adding one session handoff comment. Cover work completed, deviations and their reasons, and information the next session needs that git log does not contain. Avoid duplicate session comments. Keep `IMPLEMENTATION.md` consistent with the checkpoint.

# Reference repository

`D:\Jack\code\plex-nfo-builder-old` is a read-only reference for app functionality. Never edit it. The current implementation lives in `D:\Jack\code\plex-nfo-builder-v2`.
