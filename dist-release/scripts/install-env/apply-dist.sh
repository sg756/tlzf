#!/usr/bin/env bash
# ============================================================
#  在 Linux 服务器上执行（不要在 Windows 上跑）
#  作用：登记 systemd、下载依赖、应用 dist（或缺 dist 时编译）并启动
#  前置：install.sh（或 bootstrap.sh）
#  sudo bash scripts/install-env/apply-dist.sh
# ============================================================
[ "${ARBITRAGE_UNIX:-0}" = 1 ] || { _d="$(cd "$(dirname "$0")" && pwd)"; for _f in "$_d"/*.sh "$_d"/*.conf; do [ -f "$_f" ] && sed -i 's/\r$//' "$_f" 2>/dev/null || true; done; exec env ARBITRAGE_UNIX=1 bash "$0" "$@"; } #

set -euo pipefail
cd "$(dirname "$0")"
# shellcheck disable=SC1091
source ./common.sh

require_root
require_systemctl
source_conf

APP_ROOT="$(resolve_app_root "${APP_ROOT:-/opt/FlowOrderArbitrage}")"
APP_ROOT="${APP_ROOT:-/opt/FlowOrderArbitrage}"
sync_app_root_conf "${APP_ROOT}"
RUN_USER="${RUN_USER:-floworder-arb}"
SERVICE_NAME="${SERVICE_NAME:-floworder-arbitrage}"
COMPILE_ON_SERVER="${COMPILE_ON_SERVER:-false}"
LOG_DIR="${LOG_DIR:-${APP_ROOT}/logs}"

DIST_MAIN="${APP_ROOT}/dist/main.js"

if ! id "${RUN_USER}" >/dev/null 2>&1; then
  echo "运行用户不存在: ${RUN_USER}。请先执行 ./install.sh 或 ./bootstrap.sh" >&2
  exit 1
fi

NODE_BIN="$(resolve_node_bin || true)"
if [[ -z "${NODE_BIN}" ]]; then
  echo "未找到系统级 node。请先执行 ./install.sh 或 ./bootstrap.sh" >&2
  echo "若 Node 装在 /usr/local/bin，把绝对路径写到 arbitrage.conf 的 NODE_BIN" >&2
  exit 1
fi

echo "==> 应用目录: ${APP_ROOT}"
echo "==> Node: ${NODE_BIN} ($("${NODE_BIN}" -v 2>/dev/null || echo 未知))"
echo "==> 配置来自: $(pwd)/arbitrage.conf"

LOG_TODAY="${LOG_DIR}/arb-$(date +%Y-%m-%d).log"
RUN_WRAP="${APP_ROOT}/bin/arb-run.sh"
mkdir -p "${LOG_DIR}" "${APP_ROOT}/bin" "${APP_ROOT}/data"
touch "${LOG_TODAY}"

cat > "${RUN_WRAP}" <<RUN
#!/usr/bin/env bash
set -euo pipefail
APP_ROOT='${APP_ROOT}'
LOG_DIR='${LOG_DIR}'
NODE_BIN='${NODE_BIN}'
cd "\${APP_ROOT}"
mkdir -p "\${LOG_DIR}"
export LOG_DIR="\${LOG_DIR}"
if [[ ! -f "\${APP_ROOT}/dist/main.js" ]]; then
  echo "缺少 \${APP_ROOT}/dist/main.js" >&2
  exit 1
fi
exec "\${NODE_BIN}" dist/main.js
RUN
chmod 755 "${RUN_WRAP}"
echo "==> 已写入启动包装: ${RUN_WRAP}"

if [[ -d /etc/cron.daily ]]; then
  cat > "/etc/cron.daily/${SERVICE_NAME}-logs" <<CLEAN
#!/bin/sh
find '${LOG_DIR}' -maxdepth 1 -type f -name 'arb-????-??-??.log' -mtime +14 -delete 2>/dev/null || true
find '${LOG_DIR}' -maxdepth 1 -type f -name 'arb-????-??-??.log.gz' -mtime +14 -delete 2>/dev/null || true
CLEAN
  chmod 755 "/etc/cron.daily/${SERVICE_NAME}-logs"
  echo "==> 已写入日志清理: /etc/cron.daily/${SERVICE_NAME}-logs（保留 14 天）"
fi

echo "==> 写入 systemd: ${SERVICE_NAME}.service"
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=FlowOrderArbitrage hedge signal forwarder
After=network.target
Wants=network.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_USER}
WorkingDirectory=${APP_ROOT}
Environment=NODE_ENV=production
Environment=LOG_DIR=${LOG_DIR}
ExecStart=${RUN_WRAP}
Restart=on-failure
RestartSec=3
TimeoutStopSec=15
KillMode=mixed
NoNewPrivileges=true
LimitNOFILE=65535
StandardOutput=null
StandardError=null
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.service"

need_compile=0
if [[ "${COMPILE_ON_SERVER}" == "true" || "${COMPILE_ON_SERVER}" == "1" ]]; then
  need_compile=1
elif [[ ! -f "${DIST_MAIN}" && -f "${APP_ROOT}/src/main.ts" ]]; then
  echo "==> 没有 dist/main.js，检测到 src/，将在服务器上编译"
  need_compile=1
fi

if [[ "${need_compile}" -eq 1 ]]; then
  if [[ ! -f "${APP_ROOT}/package.json" ]]; then
    echo "服务器编译需要 ${APP_ROOT}/package.json（请上传整仓）" >&2
    exit 1
  fi
  if [[ ! -f "${APP_ROOT}/src/main.ts" ]]; then
    echo "COMPILE_ON_SERVER=true 但缺少 ${APP_ROOT}/src/main.ts" >&2
    exit 1
  fi
  if [[ ! -f "${APP_ROOT}/tsconfig.json" ]]; then
    echo "缺少 ${APP_ROOT}/tsconfig.json，无法编译" >&2
    exit 1
  fi
  install_linux_npm "${APP_ROOT}" "${RUN_USER}" 1
  echo "==> npm run build"
  NPM_CACHE="/var/tmp/${RUN_USER}-npm-cache"
  if sudo -u "${RUN_USER}" test -x "${APP_ROOT}" 2>/dev/null; then
    sudo -u "${RUN_USER}" env HOME="${NPM_CACHE}" PATH="${PATH}" \
      bash -c "cd '${APP_ROOT}' && npm run build"
  else
    (cd "${APP_ROOT}" && npm run build)
  fi
else
  if [[ ! -f "${APP_ROOT}/package.json" ]]; then
    echo "缺少 ${APP_ROOT}/package.json（应与 dist/ 同级）。" >&2
    echo "请在「含 package.json 和 dist/ 的那一层」执行：" >&2
    echo "  sudo bash scripts/install-env/apply-dist.sh" >&2
    echo "不要在另一份脚本目录里跑（会去读 arbitrage.conf 里的 ${APP_ROOT:-/opt/FlowOrderArbitrage}）。" >&2
    exit 1
  fi
  install_linux_npm "${APP_ROOT}" "${RUN_USER}" 0
  echo "==> 使用已上传的 dist/（不在服务器编译）"
  if [[ -f "${APP_ROOT}/scripts/copy-ui.cjs" ]] && [[ ! -f "${APP_ROOT}/dist/vendor/sql-wasm.wasm" ]]; then
    echo "==> 补拷 sql.js wasm 到 dist/vendor"
    NPM_CACHE="/var/tmp/${RUN_USER}-npm-cache"
    if sudo -u "${RUN_USER}" test -x "${APP_ROOT}" 2>/dev/null; then
      sudo -u "${RUN_USER}" env HOME="${NPM_CACHE}" PATH="${PATH}" \
        bash -c "cd '${APP_ROOT}' && node scripts/copy-ui.cjs"
    else
      (cd "${APP_ROOT}" && node scripts/copy-ui.cjs)
    fi
  fi
fi

if [[ ! -f "${DIST_MAIN}" ]]; then
  echo "缺少 ${DIST_MAIN}。本机跑 scripts/deploy-windows/build.ps1，把 dist-release/ 的内容覆盖到 ${APP_ROOT}，或把 COMPILE_ON_SERVER 改为 true" >&2
  exit 1
fi

chown -R "${RUN_USER}:${RUN_USER}" "${APP_ROOT}" || true
chown -R "${RUN_USER}:${RUN_USER}" "${LOG_DIR}" 2>/dev/null || true
mkdir -p "${APP_ROOT}/data"
chown -R "${RUN_USER}:${RUN_USER}" "${APP_ROOT}/data" || true
chmod 700 "${APP_ROOT}/data" || true

echo "==> 启动 ${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}.service"

ok=0
for _ in $(seq 1 8); do
  sleep 1
  if systemctl is-active --quiet "${SERVICE_NAME}.service"; then
    ok=1
    break
  fi
done

systemctl --no-pager --full status "${SERVICE_NAME}.service" || true

if [[ "${ok}" -ne 1 ]]; then
  echo >&2
  echo "服务未能保持运行。最近日志：" >&2
  journalctl -u "${SERVICE_NAME}" -n 40 --no-pager || true
  LOG_TODAY="${LOG_DIR}/arb-$(date +%Y-%m-%d).log"
  if [[ -f "${LOG_TODAY}" ]]; then
    echo "---- ${LOG_TODAY} ----" >&2
    tail -n 40 "${LOG_TODAY}" >&2 || true
  fi
  exit 1
fi

UI_PORT="${UI_PORT:-3780}"
echo
echo "已应用到 Linux 并在跑。"
echo "  看是否在跑: systemctl status ${SERVICE_NAME}"
echo "  日志:       tail -f ${LOG_DIR}/arb-$(date +%Y-%m-%d).log"
echo "  查看页:     浏览器打开 http://服务器IP:${UI_PORT}/"
echo "  改节点/密钥: 查看页「运行配置」，保存后立刻生效"
