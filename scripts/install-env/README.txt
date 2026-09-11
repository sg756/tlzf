install-env/ · 服务器装环境 + 自动下载依赖
============================================================

Linux 服务器要跑 FlowOrderArbitrage，就从这里开始。
本服务无 Nest、无 MySQL。密钥在查看页「运行配置」里改，存在 data/app.db。

文件：
  arbitrage.conf   ← 只改这个（APP_ROOT / 运行用户 / 端口）
  bootstrap.sh     ← 首次一键：装环境 + apply-dist
  install.sh       ← 只装 Node、运行用户、防火墙（可以还没有代码）
  apply-dist.sh    ← 登记 systemd、npm 下载依赖、启动/重启
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
    APP_ROOT      发布目录（不要放 /root 下）
    UI_PORT       防火墙端口，默认 3780
    COMPILE_ON_SERVER  上传源码在服务器编译则 true；上传 dist-release 则 false


--------------------------------------------------------------------------------
脚本执行顺序
--------------------------------------------------------------------------------

  1. 改 arbitrage.conf 的 APP_ROOT
  2. 把本机 dist-release\ 的内容覆盖到 APP_ROOT（不要传 Windows 的 node_modules）
  3. sudo bash scripts/install-env/bootstrap.sh
     会自动：装 Node → apply-dist（登记服务 + npm + 启动）

  以后发版：
  本机 scripts\deploy-windows\build.ps1 → 把 dist-release\ 内容覆盖到 APP_ROOT → 
  sudo bash scripts/install-env/apply-dist.sh（再次自动 npm 并重启）

日常启停：同目录 start.sh | restart.sh | stop.sh


别搞混：
  bootstrap.sh  = 首次一键（install + apply-dist）
  install.sh    = 只装系统环境
  apply-dist.sh = 登记服务、下载依赖并启动（每次发版都跑）
