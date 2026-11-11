================================================================================
FlowOrderArbitrage 运维脚本总说明
================================================================================

本机 Windows 编译，再把产物上传到 Linux 服务器。

目录分工：

  scripts/install-env/      → 服务器装环境、自动下载依赖、启停
  scripts/deploy-windows/   → Windows 本机编译，生成 dist-release\

配置文件（脚本执行前先改）：
  服务器：install-env/arbitrage.conf（APP_ROOT）
  Windows：deploy-windows/build.conf（没有则从 example 复制）


--------------------------------------------------------------------------------
完整顺序
--------------------------------------------------------------------------------

  —— 服务器（首次，推荐一键）——
  curl -fsSL https://raw.githubusercontent.com/sg756/tlzf/main/scripts/install-env/remote-bootstrap.sh | sudo bash
  装完打开 http://服务器IP:3780/ ，默认账号 admin / admin123
  登录后在「运行配置」填主/从节点

  —— 本机 Windows（每次发版）——
  5) powershell -ExecutionPolicy Bypass -File scripts\deploy-windows\build.ps1
     → 生成 dist-release\

  —— 再回服务器 ——
  6) 将 dist-release\ 内容覆盖到 APP_ROOT（勿传 node_modules、勿传 data/）
  7) sudo bash scripts/install-env/apply-dist.sh
     自动 npm 下载 Linux 依赖并重启


--------------------------------------------------------------------------------
日常运维速查
--------------------------------------------------------------------------------

  装环境并启动                     sudo bash scripts/install-env/bootstrap.sh
  以后发版（下依赖并重启）         sudo bash scripts/install-env/apply-dist.sh
  Windows 本机编译                 scripts\deploy-windows\build.ps1
  Linux 启停                       scripts/install-env/start|restart|stop.sh
================================================================================
