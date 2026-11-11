install-env/ · 服务器装环境 + 自动下载依赖
============================================================

Linux 服务器要跑 FlowOrderArbitrage，就从这里开始。
本服务无 Nest、无 MySQL。密钥在查看页「运行配置」里改，存在 data/app.db。

文件：
  arbitrage.conf   ← 只改这个（APP_ROOT / 运行用户 / 端口）
  bootstrap.sh         ← 首次一键：装环境 +（无代码则拉 GitHub 包）+ apply-dist
  remote-bootstrap.sh  ← 空机器 curl | sudo bash 一键（先拉本目录脚本再 bootstrap）
  fetch-dist.sh        ← 从 GitHub Release 覆盖 zip 并重启
  install.sh           ← 只装 Node、运行用户、防火墙（可以还没有代码）
  apply-dist.sh        ← 登记 systemd、npm 下载依赖、启动/重启
  start.sh / restart.sh / stop.sh  ← 日常启停
  common.sh        ← 各脚本内部用，不要单独跑
  README.txt       ← 本说明

必须用：
  sudo bash scripts/install-env/bootstrap.sh
不要用 ./bootstrap.sh（从 Windows 上传时 shebang 可能带回车）。


--------------------------------------------------------------------------------
执行前要配置什么
--------------------------------------------------------------------------------

  编辑 arbitrage.conf（至少）：
    APP_ROOT      空机默认发布目录（不要放 /root 下）。
                  安装后服务器上的 conf 会改成实际路径；GitHub 仓库里仍是模板。
    UI_PORT       防火墙端口，默认 3780
    COMPILE_ON_SERVER  上传源码在服务器编译则 true；上传 dist-release 则 false


--------------------------------------------------------------------------------
脚本执行顺序
--------------------------------------------------------------------------------

  空 Linux 一条命令（推荐）：
    curl -fsSL https://raw.githubusercontent.com/sg756/tlzf/main/scripts/install-env/remote-bootstrap.sh | sudo bash
    会自动：下载脚本 → 装 Node → 拉 GitHub dist-release.zip → npm → 启动

  已有脚本目录时：
    1. 改 arbitrage.conf 的 APP_ROOT（及可选 GITHUB_REPO）
    2. sudo bash scripts/install-env/bootstrap.sh
       目录空则从 GitHub 拉包，不必先手工上传

  以后发版：
    sudo bash scripts/install-env/fetch-dist.sh
    或本机 build.ps1 覆盖 APP_ROOT 后再 apply-dist.sh

日常启停：同目录 start.sh | restart.sh | stop.sh


别搞混：
  remote-bootstrap.sh = 空机 curl 一键
  bootstrap.sh  = 首次一键（install + 必要时拉 GitHub 包 + apply-dist）
  fetch-dist.sh = 拉最新 dist-release.zip 并重启
  install.sh    = 只装系统环境
  apply-dist.sh = 登记服务、下载依赖并启动（每次发版都跑）
