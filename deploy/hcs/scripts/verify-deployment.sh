#!/usr/bin/env bash
set -euo pipefail

readonly deploy_env="${HCS_DEPLOY_ENV:-/etc/hydro-hcs/deploy.env}"
[[ -f "$deploy_env" ]] || { echo "Missing deploy environment file" >&2; exit 1; }
# shellcheck disable=SC1090
source "$deploy_env"

required=(HCS_IMAGE HCS_POSTGRES_IMAGE HCS_AGE_IMAGE HCS_ACL_PROBE_IMAGE HCS_CONFIG_DIR HCS_BIND_ADDRESS HCS_HTTPS_PORT HCS_STORAGE_ENCRYPTION_EVIDENCE_FILE HCS_BACKUP_RETENTION_SECONDS HCS_TABLE_RETENTION_SECONDS HCS_ABSOLUTE_RETENTION_SECONDS)
for name in "${required[@]}"; do
  [[ -n "${!name:-}" ]] || { echo "Missing required deployment setting: $name" >&2; exit 1; }
done
for name in HCS_IMAGE HCS_POSTGRES_IMAGE HCS_AGE_IMAGE HCS_ACL_PROBE_IMAGE; do
  [[ "${!name}" =~ @sha256:[0-9a-f]{64}$ ]] || { echo "$name must be digest-pinned" >&2; exit 1; }
done

[[ "$HCS_CONFIG_DIR" == /* && "$HCS_CONFIG_DIR" != "/" ]] || { echo "HCS_CONFIG_DIR must be a narrow absolute path" >&2; exit 1; }
for path in "$HCS_CONFIG_DIR/hcs.env" "$HCS_CONFIG_DIR/postgres-password" "$HCS_CONFIG_DIR/tls/server.crt" "$HCS_CONFIG_DIR/tls/server.key" "$HCS_CONFIG_DIR/tls/ca.pem" "$HCS_CONFIG_DIR/backup-key-manifest.json"; do
  [[ -f "$path" ]] || { echo "Missing required deployment file: $path" >&2; exit 1; }
  mode="$(stat -c '%a' "$path")"
  [[ "$mode" == "600" || "$mode" == "640" || "$mode" == "400" || "$mode" == "440" ]] || { echo "Unsafe permissions on $path: $mode" >&2; exit 1; }
done
[[ -s "$HCS_STORAGE_ENCRYPTION_EVIDENCE_FILE" ]] || { echo "Missing storage-at-rest encryption evidence" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required for atomic backup manifests" >&2; exit 1; }
HCS_TABLE_RETENTION_SECONDS="$HCS_TABLE_RETENTION_SECONDS" HCS_BACKUP_RETENTION_SECONDS="$HCS_BACKUP_RETENTION_SECONDS" HCS_ABSOLUTE_RETENTION_SECONDS="$HCS_ABSOLUTE_RETENTION_SECONDS" \
  /opt/hydro-hcs/deploy/scripts/retention-budget.sh >/dev/null

/usr/bin/docker compose --env-file "$deploy_env" -f /opt/hydro-hcs/deploy/compose.yml config --quiet
echo "Deployment configuration gate: PASS"
