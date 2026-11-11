#!/usr/bin/env bash
# ============================================================
#  一键：装环境 → 拉/覆盖 GitHub dist-release（保留 data）→ npm 并启动
#    sudo bash scripts/install-env/bootstrap.sh
#  空机器也可：
#    curl -fsSL https://raw.githubusercontent.com/sg756/tlzf/main/scripts/install-env/remote-bootstrap.sh | sudo bash
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
sync_app_root_conf "${APP_ROOT}"

echo "==> 【bootstrap】发布目录 APP_ROOT=${APP_ROOT}"
echo "==> 1/2 安装服务器环境（Node、运行用户、防火墙）"
bash "${SCRIPT_DIR}/install.sh"

echo
echo "==> 从 GitHub 拉取 dist-release.zip（已有 data/、logs/、配置会保留）"
fetch_github_dist "${APP_ROOT}"
sync_app_root_conf "${APP_ROOT}"

echo
echo "==> 2/2 登记服务、下载依赖并启动"
bash "${SCRIPT_DIR}/apply-dist.sh"

echo
echo "【bootstrap】完成。节点密钥请登录查看页「运行配置」填写。"
