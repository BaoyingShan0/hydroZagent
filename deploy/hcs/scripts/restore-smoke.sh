#!/usr/bin/env bash
set -euo pipefail

readonly deploy_env="${HCS_DEPLOY_ENV:-/etc/hydro-hcs/deploy.env}"
# shellcheck disable=SC1090
source "$deploy_env"
readonly encrypted_backup="${1:-}"
readonly age_identity="${2:-}"
[[ -f "$encrypted_backup" && -f "$encrypted_backup.sha256" ]] || { echo "Backup and checksum are required" >&2; exit 64; }
[[ -f "$age_identity" ]] || { echo "Recovery identity is required from the independent key facility" >&2; exit 64; }
[[ "${HCS_AGE_IMAGE:-}" =~ @sha256:[0-9a-f]{64}$ ]] || { echo "HCS_AGE_IMAGE must be digest-pinned" >&2; exit 1; }
sha256sum --check "$encrypted_backup.sha256"

readonly compose=(/usr/bin/docker compose --profile restore --env-file "$deploy_env" -f /opt/hydro-hcs/deploy/compose.yml)
"${compose[@]}" up -d restore-postgres
for _ in $(seq 1 40); do
  if "${compose[@]}" exec -T restore-postgres pg_isready -U "$HCS_POSTGRES_USER" -d "$HCS_RESTORE_POSTGRES_DB" >/dev/null 2>&1; then break; fi
  sleep 2
done
"${compose[@]}" exec -T restore-postgres pg_isready -U "$HCS_POSTGRES_USER" -d "$HCS_RESTORE_POSTGRES_DB" >/dev/null

/usr/bin/docker run --rm -i -v "$age_identity:/run/age/identity:ro" "$HCS_AGE_IMAGE" --decrypt -i /run/age/identity < "$encrypted_backup" \
  | "${compose[@]}" exec -T restore-postgres pg_restore --clean --if-exists --no-owner --no-acl -U "$HCS_POSTGRES_USER" -d "$HCS_RESTORE_POSTGRES_DB"
export HCS_DATABASE_URL="${HCS_RESTORE_DATABASE_URL:?HCS_RESTORE_DATABASE_URL must be supplied through the protected environment}"
"${compose[@]}" run --rm --no-deps -e HCS_DATABASE_URL migration node dist/db/cli.js up
"${compose[@]}" run --rm --no-deps -e HCS_DATABASE_URL hcs node dist/lifecycle/cleanupCli.js
"${compose[@]}" run --rm --no-deps -e HCS_DATABASE_URL hcs node dist/lifecycle/restoreVerifyCli.js
echo "Restore smoke completed in the isolated restore volume; manual integrity review is required before any controlled switch."
