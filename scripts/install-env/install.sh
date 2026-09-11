#!/usr/bin/env bash
# ============================================================
#  只装 Linux 服务器环境（可以还没有代码）
#  不写 systemd
#  必须：sudo bash scripts/install-env/install.sh
# ============================================================
# 从 Windows 上传带 CRLF 时仍能跑（# 后的回车当成注释）
[ "${ARBITRAGE_UNIX:-0}" = 1 ] || { _d="$(cd "$(dirname "$0")" && pwd)"; for _f in "$_d"/*.sh "$_d"/*.conf; do [ -f "$_f" ] && sed -i 's/\r$//' "$_f" 2>/dev/null || true; done; exec env ARBITRAGE_UNIX=1 bash "$0" "$@"; } #

set -euo pipefail
cd "$(dirname "$0")"
# shellcheck disable=SC1091
source ./common.sh

require_root
require_dnf
source_conf

APP_ROOT="$(resolve_app_root "${APP_ROOT:-/opt/FlowOrderArbitrage}")"
APP_ROOT="${APP_ROOT:-/opt/FlowOrderArbitrage}"
RUN_USER="${RUN_USER:-floworder-arb}"

echo "==> 【install-env】装服务器环境（CentOS 9 / RHEL 9）"
echo "==> APP_ROOT=${APP_ROOT}（仅创建目录，不要求已有代码）"

if [[ "${APP_ROOT}" == /root || "${APP_ROOT}" == /root/* ]]; then
  echo "APP_ROOT 不要放在 /root 下（权限 700，业务用户进不去）。请改 arbitrage.conf" >&2
  exit 1
fi

mkdir -p "${APP_ROOT}"

echo "==> 安装基础包"
dnf -y install ca-certificates curl tar gzip

NODE_BIN="$(resolve_node_bin || true)"
need_node=1
if [[ -n "${NODE_BIN}" ]]; then
  major="$(node_major_of "${NODE_BIN}")"
  if [[ -n "${major}" && "${major}" -ge 18 ]]; then
    need_node=0
    echo "==> 已有 Node ${major}：${NODE_BIN}（不再安装）"
  else
    echo "==> 已有 node 但版本不够：${NODE_BIN} ($("${NODE_BIN}" -v 2>/dev/null || echo 未知))，将安装 20"
  fi
else
  echo "==> sudo/root 的 PATH 里没有可用的 node（登录用户的 nvm/fnm 不算，systemd 服务也用不了）"
fi

if [[ "${need_node}" -eq 1 ]]; then
  echo "==> 安装系统级 Node.js 20（NodeSource）"
  dnf -y module reset nodejs >/dev/null 2>&1 || true
  if curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -; then
    dnf -y install nodejs
  else
    echo "    NodeSource 不可用，改用系统仓库（Node >= 18）"
    dnf -y module enable nodejs:20 >/dev/null 2>&1 || dnf -y module enable nodejs:18 >/dev/null 2>&1 || true
    dnf -y install nodejs
  fi
  NODE_BIN="$(resolve_node_bin || true)"
fi

if [[ -z "${NODE_BIN}" ]]; then
  echo "Node 安装失败" >&2
  exit 1
fi
major="$(node_major_of "${NODE_BIN}")"
if [[ -z "${major}" || "${major}" -lt 18 ]]; then
  echo "需要 Node 18+，当前: ${NODE_BIN} $("${NODE_BIN}" -v 2>/dev/null || echo 无)" >&2
  exit 1
fi
NPM_BIN="$(dirname "${NODE_BIN}")/npm"
if [[ ! -x "${NPM_BIN}" ]]; then
  NPM_BIN="$(command -v npm || true)"
fi
if [[ -n "${NPM_BIN}" && -x "${NPM_BIN}" ]]; then
  echo "    node=$("${NODE_BIN}" -v) npm=$("${NPM_BIN}" -v)  (${NODE_BIN})"
else
  echo "    node=$("${NODE_BIN}" -v)  (${NODE_BIN})"
fi

echo "==> 创建运行用户 ${RUN_USER}"
if ! id "${RUN_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${APP_ROOT}" --no-create-home --shell /sbin/nologin "${RUN_USER}"
fi
chown -R "${RUN_USER}:${RUN_USER}" "${APP_ROOT}"

UI_PORT="${UI_PORT:-3780}"
if [[ "${UI_PORT}" =~ ^[0-9]+$ ]] && [[ "${UI_PORT}" -gt 0 ]]; then
  if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
    echo "==> 防火墙放行查看页 ${UI_PORT}/tcp"
    firewall-cmd --permanent --add-port="${UI_PORT}/tcp" || true
    firewall-cmd --reload || true
  else
    echo "==> 未检测到运行中的 firewalld，跳过放行 ${UI_PORT}（需要时自行开端口）"
  fi
fi

echo
echo "【install-env/install】环境安装完成。"
echo "下一步：代码放到 ${APP_ROOT} 后执行 sudo bash $(pwd)/apply-dist.sh"
