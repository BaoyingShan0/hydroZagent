#!/usr/bin/env bash
set -euo pipefail

readonly deploy_env="${HCS_DEPLOY_ENV:-/etc/hydro-hcs/deploy.env}"
# shellcheck disable=SC1090
source "$deploy_env"
readonly compose=(/usr/bin/docker compose --env-file "$deploy_env" -f /opt/hydro-hcs/deploy/compose.yml)

"${compose[@]}" ps --status running hcs postgres | grep -q hcs
curl --fail --silent --show-error --cacert "$HCS_CONFIG_DIR/tls/ca.pem" "https://${HCS_BIND_ADDRESS}:${HCS_HTTPS_PORT}/readyz" >/dev/null
if ss -lnt | awk '{print $4}' | grep -Eq '(^|:)5432$'; then
  echo "PostgreSQL is unexpectedly exposed on the host" >&2
  exit 1
fi
"${compose[@]}" exec -T hcs node -e "fetch(process.env.HCS_UPSTREAM_HEALTH_URL,{headers:{authorization:'Bearer '+process.env.HCS_UPSTREAM_API_KEY}}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
echo "Runtime HTTPS, database exposure, and HCS-to-model checks: PASS"
