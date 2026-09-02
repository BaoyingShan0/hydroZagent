#!/usr/bin/env bash
set -euo pipefail

readonly deploy_env="${HCS_DEPLOY_ENV:-/etc/hydro-hcs/deploy.env}"
# shellcheck disable=SC1090
source "$deploy_env"
[[ -n "${HCS_MODEL_ACL_TEST_URL:-}" ]] || { echo "HCS_MODEL_ACL_TEST_URL is required" >&2; exit 1; }
[[ "${HCS_ACL_PROBE_IMAGE:-}" =~ @sha256:[0-9a-f]{64}$ ]] || { echo "HCS_ACL_PROBE_IMAGE must be digest-pinned" >&2; exit 1; }

readonly compose=(/usr/bin/docker compose --env-file "$deploy_env" -f /opt/hydro-hcs/deploy/compose.yml)
"${compose[@]}" exec -T hcs node -e "fetch(process.env.HCS_MODEL_ACL_TEST_URL).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
if /usr/bin/docker run --rm --network bridge "$HCS_ACL_PROBE_IMAGE" --fail --silent --max-time 8 "$HCS_MODEL_ACL_TEST_URL" >/dev/null 2>&1; then
  echo "Model endpoint is reachable outside the HCS network identity" >&2
  exit 1
fi
echo "Model service ACL source restriction: PASS"
