#!/usr/bin/env bash
# sudo bash scripts/install-env/start.sh
[ "${ARBITRAGE_UNIX:-0}" = 1 ] || { _d="$(cd "$(dirname "$0")" && pwd)"; for _f in "$_d"/*.sh "$_d"/*.conf; do [ -f "$_f" ] && sed -i 's/\r$//' "$_f" 2>/dev/null || true; done; exec env ARBITRAGE_UNIX=1 bash "$0" "$@"; } #

set -euo pipefail
cd "$(dirname "$0")"
# shellcheck disable=SC1091
source ./common.sh
require_root
require_systemctl
source_conf
SERVICE_NAME="${SERVICE_NAME:-floworder-arbitrage}"
systemctl start "${SERVICE_NAME}.service"
sleep 1
systemctl --no-pager --full status "${SERVICE_NAME}.service" || true
