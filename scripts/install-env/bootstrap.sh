#!/usr/bin/env bash
# ============================================================
#  首次一键：装环境 → 下载依赖并启动
#  先改同目录 arbitrage.conf 的 APP_ROOT，再：
#    sudo bash scripts/install-env/bootstrap.sh
# ============================================================
[ "${ARBITRAGE_UNIX:-0}" = 1 ] || { _d="$(cd "$(dirname "$0")" && pwd)"; for _f in "$_d"/*.sh "$_d"/*.conf; do [ -f "$_f" ] && sed -i 's/\r$//' "$_f" 2>/dev/null || true; done; exec env ARBITRAGE_UNIX=1 bash "$0" "$@"; } #

set -euo pipefail
cd "$(dirname "$0")"
# shellcheck disable=SC1091
source ./common.sh

require_root
source_conf

APP_ROOT="$(resolve_app_root "${APP_ROOT:-/opt/FlowOrderArbitrage}")"
APP_ROOT="${APP_ROOT:-/opt/FlowOrderArbitrage}"
SCRIPT_DIR="$(pwd)"

echo "==> 【bootstrap】发布目录 APP_ROOT=${APP_ROOT}"
echo "==> 1/2 安装服务器环境（Node、运行用户、防火墙）"
bash "${SCRIPT_DIR}/install.sh"

if [[ ! -f "${APP_ROOT}/package.json" && ! -f "${APP_ROOT}/dist/main.js" ]]; then
  echo
  echo "环境已装好，但 ${APP_ROOT} 里还没有代码。"
  echo "请把本机 dist-release/ 的内容覆盖到 ${APP_ROOT}（package.json 与 dist/ 同级；不要传 Windows 的 node_modules），然后再次执行："
  echo "  sudo bash ${SCRIPT_DIR}/bootstrap.sh"
  exit 0
fi

echo
echo "==> 2/2 登记服务、下载依赖并启动"
bash "${SCRIPT_DIR}/apply-dist.sh"

echo
echo "【bootstrap】完成。节点密钥请登录查看页「运行配置」填写。"
