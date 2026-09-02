#!/usr/bin/env bash
set -euo pipefail

for name in HCS_TABLE_RETENTION_SECONDS HCS_BACKUP_RETENTION_SECONDS HCS_ABSOLUTE_RETENTION_SECONDS; do
  [[ "${!name:-}" =~ ^[1-9][0-9]*$ ]] || { echo "$name must be a positive integer" >&2; exit 1; }
done
total=$((HCS_TABLE_RETENTION_SECONDS + HCS_BACKUP_RETENTION_SECONDS))
(( total <= HCS_ABSOLUTE_RETENTION_SECONDS )) || {
  echo "Retention budget violation: T_table + T_backup exceeds T_absolute" >&2
  exit 1
}
echo "Retention budget: PASS (${HCS_TABLE_RETENTION_SECONDS} + ${HCS_BACKUP_RETENTION_SECONDS} <= ${HCS_ABSOLUTE_RETENTION_SECONDS})"
