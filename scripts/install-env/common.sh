#!/usr/bin/env bash
# 公共函数。由 install/apply-dist/start/restart/stop source，不要单独执行。

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "请用 root 执行：sudo bash $0" >&2
    exit 1
  fi
}

# 去掉 Windows 回车再 source，避免 APP_ROOT / SERVICE_NAME 带 \r
source_conf() {
  local f="${1:-./arbitrage.conf}"
  if [[ ! -f "$f" ]]; then
    echo "找不到配置文件: $f" >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  source /dev/stdin <<< "$(tr -d '\r' < "$f")"
}

require_dnf() {
  if ! command -v dnf >/dev/null 2>&1; then
    echo "未找到 dnf。本脚本面向 CentOS 9 / RHEL 9。" >&2
    exit 1
  fi
}

require_systemctl() {
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "未找到 systemctl。需要 systemd（CentOS 9 服务器）。" >&2
    exit 1
  fi
}

node_major_of() {
  local bin=$1
  "$bin" -v 2>/dev/null | sed 's/^v//' | cut -d. -f1
}

# 发布根目录：脚本在仓库 scripts/install-env 下时，优先用上两级（有 package.json）。
# 这样上传到哪，就在哪执行 apply-dist，不必和 conf 里的路径逐字一致。
# 脚本单独放、旁边没有代码时，仍用 conf 的 APP_ROOT。
resolve_app_root() {
  local conf_root=${1:-}
  local script_root
  script_root="$(cd "$(pwd)/../.." && pwd)"
  local ok_script=0
  local ok_conf=0
  if [[ -f "${script_root}/package.json" ]] && { [[ -f "${script_root}/dist/main.js" ]] || [[ -f "${script_root}/src/main.ts" ]]; }; then
    ok_script=1
  fi
  if [[ -n "${conf_root}" && -f "${conf_root}/package.json" ]] && { [[ -f "${conf_root}/dist/main.js" ]] || [[ -f "${conf_root}/src/main.ts" ]]; }; then
    ok_conf=1
  fi
  if [[ "${ok_script}" -eq 1 ]]; then
    if [[ -n "${conf_root}" && "${conf_root}" != "${script_root}" ]]; then
      echo "==> APP_ROOT=${script_root}（按脚本位置；conf 里是 ${conf_root}）" >&2
    fi
    echo "${script_root}"
    return 0
  fi
  if [[ "${ok_conf}" -eq 1 ]]; then
    echo "${conf_root}"
    return 0
  fi
  echo "${conf_root}"
}

# 把实际安装目录写回服务器上的 arbitrage.conf（不改 GitHub 仓库模板）。
sync_app_root_conf() {
  local root=$1
  local f
  [[ -n "$root" ]] || return 0
  for f in "./arbitrage.conf" "${root}/scripts/install-env/arbitrage.conf"; do
    [[ -f "$f" ]] || continue
    if grep -q '^APP_ROOT=' "$f"; then
      sed -i "s|^APP_ROOT=.*|APP_ROOT=${root}|" "$f"
    else
      printf '\nAPP_ROOT=%s\n' "$root" >> "$f"
    fi
  done
}

github_release_zip_url() {
  local repo=${1:-${GITHUB_REPO:-sg756/tlzf}}
  local tag=${2:-${GITHUB_RELEASE_TAG:-dist}}
  echo "https://github.com/${repo}/releases/download/${tag}/dist-release.zip"
}

github_latest_zip_url() {
  local repo=${1:-${GITHUB_REPO:-sg756/tlzf}}
  echo "https://github.com/${repo}/releases/latest/download/dist-release.zip"
}

curl_github() {
  local url=$1
  local out=$2
  local args=(-fsSL --retry 3 --retry-delay 2 -o "$out")
  if [[ -n "${GH_TOKEN:-${GITHUB_TOKEN:-}}" ]]; then
    args+=(-H "Authorization: Bearer ${GH_TOKEN:-${GITHUB_TOKEN}}")
  fi
  curl "${args[@]}" "$url"
}

# 从 GitHub Release 把 dist-release.zip 覆盖到 dest（保留 dest/data、dest/logs）
fetch_github_dist() {
  local dest=$1
  local repo=${GITHUB_REPO:-sg756/tlzf}
  local tag=${GITHUB_RELEASE_TAG:-dist}
  local tmp zip unpack
  if ! command -v unzip >/dev/null 2>&1; then
    if command -v dnf >/dev/null 2>&1; then
      dnf -y install unzip >/dev/null
    else
      echo "需要 unzip。请先安装 unzip。" >&2
      return 1
    fi
  fi
  mkdir -p "$dest"
  tmp="$(mktemp -d /tmp/foarb-dist-XXXX)"
  zip="${tmp}/dist-release.zip"
  unpack="${tmp}/unpack"
  mkdir -p "$unpack"
  echo "==> 从 GitHub 拉取发布包 ${repo} tag=${tag}"
  if ! curl_github "$(github_release_zip_url "$repo" "$tag")" "$zip"; then
    echo "    tag=${tag} 没有包，改试 latest"
    if ! curl_github "$(github_latest_zip_url "$repo")" "$zip"; then
      echo "无法下载 dist-release.zip。请确认仓库 ${repo} 已有 GitHub Release。" >&2
      rm -rf "$tmp"
      return 1
    fi
  fi
  unzip -qo "$zip" -d "$unpack"
  local src="$unpack"
  if [[ ! -f "${unpack}/package.json" ]]; then
    local inner
    inner="$(find "$unpack" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
    if [[ -n "$inner" && -f "${inner}/package.json" ]]; then
      src="$inner"
    fi
  fi
  if [[ ! -f "${src}/package.json" ]]; then
    echo "发布包里没有 package.json" >&2
    rm -rf "$tmp"
    return 1
  fi
  echo "==> 覆盖到 ${dest}（保留 data/、logs/、已有 arbitrage.conf）"
  local keep_conf=0
  if [[ -f "${dest}/scripts/install-env/arbitrage.conf" ]]; then
    keep_conf=1
    cp -a "${dest}/scripts/install-env/arbitrage.conf" "${tmp}/arbitrage.conf.keep"
  fi
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --exclude data --exclude logs --exclude node_modules \
      --exclude scripts/install-env/arbitrage.conf \
      "${src}/" "${dest}/"
  else
    (
      cd "$src"
      tar --exclude=data --exclude=logs --exclude=node_modules \
        --exclude=scripts/install-env/arbitrage.conf -cf - .
    ) | tar -C "$dest" -xf -
  fi
  mkdir -p "${dest}/scripts/install-env"
  if [[ "${keep_conf}" -eq 1 ]]; then
    cp -a "${tmp}/arbitrage.conf.keep" "${dest}/scripts/install-env/arbitrage.conf"
  elif [[ -f "${src}/scripts/install-env/arbitrage.conf" && ! -f "${dest}/scripts/install-env/arbitrage.conf" ]]; then
    cp -a "${src}/scripts/install-env/arbitrage.conf" "${dest}/scripts/install-env/arbitrage.conf"
  fi
  rm -rf "$tmp"
  if [[ ! -f "${dest}/package.json" ]] || { [[ ! -f "${dest}/dist/main.js" ]] && [[ ! -f "${dest}/src/main.ts" ]]; }; then
    echo "覆盖后 ${dest} 仍不完整（需要 package.json 与 dist/main.js）" >&2
    return 1
  fi
  echo "==> 发布包已放到 ${dest}"
}

# 找系统级 node（sudo 的 PATH 往往没有 /usr/local/bin，也看不到用户 nvm）。
# 优先：arbitrage.conf 的 NODE_BIN → /usr/local/bin → PATH → /usr/bin
# 不采用家目录里的 nvm/fnm，systemd 的业务用户跑不起来。
resolve_node_bin() {
  local c
  is_system_node() {
    local p=$1
    [[ -n "$p" && -x "$p" ]] || return 1
    case "$p" in
      /home/*|*/.nvm/*|*/.fnm/*|*/.local/share/fnm/*) return 1 ;;
    esac
    return 0
  }
  for c in "${NODE_BIN:-}" \
    /usr/local/bin/node \
    /usr/local/bin/nodejs \
    "$(command -v node 2>/dev/null || true)" \
    "$(command -v nodejs 2>/dev/null || true)" \
    /usr/bin/node \
    /usr/bin/nodejs; do
    if is_system_node "$c"; then
      echo "$c"
      return 0
    fi
  done
  return 1
}

# 在 Linux 上安装 npm 依赖（不要沿用 Windows 的 node_modules）
# 用法：install_linux_npm PKG_DIR RUN_USER [with_dev]
# PKG_DIR = 含 package.json 的目录（发版是 APP_ROOT/dist，服务器编译是 APP_ROOT）
# with_dev=1 时装完整依赖；否则 --omit=dev
install_linux_npm() {
  local pkg_dir=$1
  local run_user=$2
  local with_dev=${3:-0}
  local npm_cache="/var/tmp/${run_user}-npm-cache"
  local lock="${pkg_dir}/package-lock.json"
  local run_as_root=0

  if [[ ! -f "${pkg_dir}/package.json" ]]; then
    echo "缺少 ${pkg_dir}/package.json" >&2
    return 1
  fi

  mkdir -p "${npm_cache}"
  chown -R "${run_user}:${run_user}" "${npm_cache}" || true
  chown -R "${run_user}:${run_user}" "${pkg_dir}" || true

  if ! sudo -u "${run_user}" test -x "${pkg_dir}" 2>/dev/null \
    || ! sudo -u "${run_user}" test -r "${pkg_dir}/package.json" 2>/dev/null; then
    echo "==> 权限问题：用户 ${run_user} 无法访问 ${pkg_dir}" >&2
    echo "    典型原因：APP_ROOT 在 /root 下，或目录权限不是 755。" >&2
    if [[ "${pkg_dir}" == /root || "${pkg_dir}" == /root/* ]]; then
      echo "    本次临时用 root 执行 npm，装完再 chown。" >&2
      run_as_root=1
    else
      echo "    请把 APP_ROOT 改到 /opt/FlowOrderArbitrage，再重试。" >&2
      return 1
    fi
  fi

  echo "==> 安装 Linux 依赖（目录 ${pkg_dir}，删除可能来自 Windows 的 node_modules）"
  rm -rf "${pkg_dir}/node_modules"

  run_npm() {
    if [[ "${run_as_root}" -eq 1 ]]; then
      npm "$@" --prefix "${pkg_dir}" --cache "${npm_cache}"
    else
      sudo -u "${run_user}" env HOME="${npm_cache}" PATH="${PATH}" \
        npm "$@" --prefix "${pkg_dir}" --cache "${npm_cache}"
    fi
  }

  local lock_ok=0
  if [[ -s "${lock}" ]] && grep -q '"lockfileVersion"' "${lock}"; then
    lock_ok=1
  fi

  local omit=()
  if [[ "${with_dev}" != "1" && "${with_dev}" != "true" ]]; then
    omit=(--omit=dev)
  fi

  if [[ "${lock_ok}" -eq 1 ]]; then
    echo "    使用 npm ci ${omit[*]:-}"
    if [[ ${#omit[@]} -gt 0 ]]; then
      if ! run_npm ci "${omit[@]}"; then
        echo "    npm ci 失败，回退 npm install" >&2
        run_npm install "${omit[@]}"
      fi
    else
      if ! run_npm ci; then
        echo "    npm ci 失败，回退 npm install" >&2
        run_npm install
      fi
    fi
  else
    echo "    无有效 package-lock.json → npm install ${omit[*]:-}"
    if [[ ${#omit[@]} -gt 0 ]]; then
      run_npm install "${omit[@]}"
    else
      run_npm install
    fi
  fi
}
