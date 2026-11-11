#!/usr/bin/env bash
# 把当前仓库编好的 dist/ 打成 dist-release/ 和 dist-release.zip（供 GitHub Release）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${ROOT}/dist-release"
ZIP="${ROOT}/dist-release.zip"

if [[ ! -f "${ROOT}/dist/main.js" ]]; then
  echo "缺少 ${ROOT}/dist/main.js，请先 npm run build" >&2
  exit 1
fi
if [[ ! -f "${ROOT}/package-lock.json" ]]; then
  echo "缺少 package-lock.json" >&2
  exit 1
fi

rm -rf "$OUT" "$ZIP"
mkdir -p "$OUT/dist" "$OUT/scripts/install-env"
cp "${ROOT}/package.json" "${ROOT}/package-lock.json" "$OUT/"
cp -a "${ROOT}/dist/." "$OUT/dist/"
rm -f "$OUT/dist/package.json" "$OUT/dist/package-lock.json"
if [[ -f "${ROOT}/scripts/copy-ui.cjs" ]]; then
  cp "${ROOT}/scripts/copy-ui.cjs" "$OUT/scripts/"
fi
cp -a "${ROOT}/scripts/install-env/." "$OUT/scripts/install-env/"

if [[ ! -f "$OUT/dist/main.js" || ! -f "$OUT/package.json" ]]; then
  echo "发布包校验失败" >&2
  exit 1
fi

(
  cd "$OUT"
  zip -r "$ZIP" .
)

echo "已生成 ${OUT} 与 ${ZIP}"
