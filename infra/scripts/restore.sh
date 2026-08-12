#!/bin/sh
set -eu

source_file="${1:-}"
target_database="${2:-}"
if [ -z "$source_file" ] || [ "${source_file#/backups/}" = "$source_file" ] || [ -z "$target_database" ]; then
  echo "usage: restore.sh /backups/<name>.dump <isolated-target-database>" >&2
  exit 64
fi
if [ "$target_database" = "$POSTGRES_DB" ] && [ "${ALLOW_IN_PLACE_RESTORE:-}" != "I_UNDERSTAND_DATA_WILL_BE_REPLACED" ]; then
  echo "refusing in-place restore without ALLOW_IN_PLACE_RESTORE acknowledgement" >&2
  exit 65
fi

sha256sum -c "${source_file}.sha256"
pg_restore --list "$source_file" >/dev/null
dropdb --if-exists --force --username="$POSTGRES_USER" "$target_database"
createdb --username="$POSTGRES_USER" "$target_database"
pg_restore --exit-on-error --no-owner --no-acl --clean --if-exists \
  --username="$POSTGRES_USER" --dbname="$target_database" "$source_file"
echo "$target_database"
