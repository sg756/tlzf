#!/usr/bin/env bash
# ============================================================
#  空 Linux 一键：拉安装脚本 + 拉 dist-release + 装环境 + 启动
#  空机器上执行（不要先上传代码）：
#    curl -fsSL https://raw.githubusercontent.com/sg756/tlzf/main/scripts/install-env/remote-bootstrap.sh | sudo bash
# ============================================================
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "请用 root 执行：curl ... | sudo bash" >&2
  exit 1
fi

REPO="${GITHUB_REPO:-sg756/tlzf}"
BRANCH="${GITHUB_BRANCH:-main}"
BASE="https://raw.githubusercontent.com/${REPO}/${BRANCH}/scripts/install-env"
WORKDIR="$(mktemp -d /tmp/foarb-boot-XXXX)"

echo "==> 下载安装脚本 ${REPO}@${BRANCH} → ${WORKDIR}"
if ! command -v curl >/dev/null 2>&1; then
  if command -v dnf >/dev/null 2>&1; then
    dnf -y install curl ca-certificates
  else
    echo "需要 curl" >&2
    exit 1
  fi
fi

files=(
  common.sh
  arbitrage.conf
  install.sh
  apply-dist.sh
  bootstrap.sh
  fetch-dist.sh
  start.sh
  restart.sh
  stop.sh
)
for f in "${files[@]}"; do
  curl -fsSL --retry 3 "${BASE}/${f}" -o "${WORKDIR}/${f}"
  sed -i 's/\r$//' "${WORKDIR}/${f}" 2>/dev/null || true
  chmod +x "${WORKDIR}/${f}" 2>/dev/null || true
done

echo "==> 执行 bootstrap（装环境、拉发布包、启动）"
exec env ARBITRAGE_UNIX=1 bash "${WORKDIR}/bootstrap.sh"
