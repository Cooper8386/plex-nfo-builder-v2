#!/bin/sh
set -eu

if [ "$(id -u)" = 0 ]; then
  puid="${PUID:-1000}"
  pgid="${PGID:-1000}"
  case "$puid" in ''|*[!0-9]*) echo "PUID must be numeric" >&2; exit 1;; esac
  case "$pgid" in ''|*[!0-9]*) echo "PGID must be numeric" >&2; exit 1;; esac
  chown -R "$puid:$pgid" /config
  exec gosu "$puid:$pgid" "$@"
fi

exec "$@"
