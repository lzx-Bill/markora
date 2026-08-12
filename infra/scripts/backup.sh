#!/bin/sh
set -eu

destination="${1:-}"
if [ -z "$destination" ] || [ "${destination#/backups/}" = "$destination" ]; then
  echo "usage: backup.sh /backups/<name>.dump" >&2
  exit 64
fi

umask 077
temporary="${destination}.part"
rm -f "$temporary"
pg_dump --format=custom --compress=9 --no-owner --no-acl \
  --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --file="$temporary"
pg_restore --list "$temporary" >/dev/null
mv "$temporary" "$destination"
sha256sum "$destination" >"${destination}.sha256"
echo "$destination"
