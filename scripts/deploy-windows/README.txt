Windows 构建与发布流程
============================================================

本目录 = Windows 本机编译（build.ps1）。
产物 = 仓库根 dist-release\（结构与 Linux APP_ROOT、以及 FlowOrder 的 apps/api 相同）。
Linux 上装环境、下依赖、启服务 = ../install-env/


--------------------------------------------------------------------------------
执行前要配置什么
--------------------------------------------------------------------------------

  【服务器】编辑 ../install-env/arbitrage.conf
    APP_ROOT   发布目录（推荐 /opt/FlowOrderArbitrage，不要放 /root 下）
    UI_PORT    防火墙放行端口（默认 3780）

  【本机 Windows】没有 build.conf 时从 build.conf.example 复制（脚本会自动复制）
    SOURCE_ROOT  本机源码（空=仓库根）
    RELEASE_DIR  上传包（空=仓库根\dist-release）
    NODE_HOME    便携 Node；没有 Node 时脚本自动下载
    SKIP_CONFIRM true 则不问确认


--------------------------------------------------------------------------------
脚本执行顺序
--------------------------------------------------------------------------------

  —— 服务器首次 ——
  1. 改 install-env/arbitrage.conf 的 APP_ROOT
  2. 把 dist-release\ 的内容覆盖到 APP_ROOT
  3. sudo bash scripts/install-env/bootstrap.sh
     → 自动：装 Node / 运行用户 / 防火墙 → 写 systemd → npm 下载依赖 → 启动

  —— 本机每次发版 ——
  4. powershell -ExecutionPolicy Bypass -File scripts\deploy-windows\build.ps1
     生成 dist-release\ ：
       package.json
       package-lock.json
       dist\

  —— 再回服务器 ——
  5. 把 dist-release\ 内容覆盖到 APP_ROOT（不要传 node_modules、不要传 data/）
  6. sudo bash scripts/install-env/apply-dist.sh
     → 自动 npm 装 Linux 依赖并重启

  日常启停：
    sudo bash scripts/install-env/start.sh
    sudo bash scripts/install-env/restart.sh
    sudo bash scripts/install-env/stop.sh


别搞混：
  dist\           本机编译输出（tsc），不要拿去当上传包
  dist-release\   上传包：package.json 与 dist\ 同级
  bootstrap.sh    首次一键：环境 + 依赖 + 启动
  apply-dist.sh   以后发版：下载依赖并重启
  运行配置        查看页里改，存在 data/app.db，不要用文件配密钥
