#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly deploy_env="${HCS_DEPLOY_ENV:-/etc/hydro-hcs/deploy.env}"
# shellcheck disable=SC1090
source "$deploy_env"
[[ "${HCS_AGE_IMAGE:-}" =~ @sha256:[0-9a-f]{64}$ ]] || { echo "HCS_AGE_IMAGE must be digest-pinned" >&2; exit 1; }
[[ "${HCS_BACKUP_DIR:-}" == /* && "$HCS_BACKUP_DIR" != "/" ]] || { echo "Unsafe backup directory" >&2; exit 1; }
[[ -s "${HCS_BACKUP_RECIPIENT_FILE:-}" ]] || { echo "Missing age recipient public key" >&2; exit 1; }

install -d -m 0700 "$HCS_BACKUP_DIR"
readonly stamp="$(date -u +%Y%m%dT%H%M%SZ)"
readonly partial="$HCS_BACKUP_DIR/hydro-hcs-$stamp.sql.age.partial"
readonly output="$HCS_BACKUP_DIR/hydro-hcs-$stamp.sql.age"
readonly manifest="$HCS_CONFIG_DIR/backup-key-manifest.json"
readonly recipient="$(tr -d '\r\n' < "$HCS_BACKUP_RECIPIENT_FILE")"
readonly compose=(/usr/bin/docker compose --env-file "$deploy_env" -f /opt/hydro-hcs/deploy/compose.yml)

cleanup() { rm -f -- "$partial"; }
trap cleanup EXIT
"${compose[@]}" exec -T postgres pg_dump --format=custom --no-owner --no-acl -U "$HCS_POSTGRES_USER" "$HCS_POSTGRES_DB" \
  | /usr/bin/docker run --rm -i "$HCS_AGE_IMAGE" -r "$recipient" > "$partial"
[[ -s "$partial" ]] || { echo "Encrypted backup is empty" >&2; exit 1; }
mv -- "$partial" "$output"
trap - EXIT
sha256sum "$output" > "$output.sha256"
readonly key_ids="$("${compose[@]}" run --rm --no-deps hcs node -e "const v=JSON.parse(process.env.HCS_USAGE_KEYRING_JSON);process.stdout.write(JSON.stringify(Object.keys(v.keys).sort()))")"
readonly expires_at="$(date -u -d "+${HCS_BACKUP_RETENTION_SECONDS:?} seconds" +%Y-%m-%dT%H:%M:%SZ)"
readonly manifest_partial="$manifest.partial"
jq --arg id "hydro-hcs-$stamp" --arg expires_at "$expires_at" --argjson key_ids "$key_ids" \
  '.backups = ([.backups[] | select((.expires_at | fromdateiso8601) > now)] + [{id:$id,expires_at:$expires_at,key_ids:$key_ids}])' \
  "$manifest" > "$manifest_partial"
chmod --reference="$manifest" "$manifest_partial"
chown --reference="$manifest" "$manifest_partial"
mv -- "$manifest_partial" "$manifest"
echo "Encrypted backup created: $output"
