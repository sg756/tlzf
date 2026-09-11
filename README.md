# 套利对冲组合信号转发

套利对冲组合信号转发

简介
此服务是在 cbb 中间件（cbb超级套利 ）基础上做的套利信号接收转发  ，好处就是软件可以控制多个自己的账户同时开启组合,再也不用手忙脚乱了 .
##
架构
本系统 Node.js 编写，无 Nest  。进程内带查看页（侧栏「信号显示」「POST日志」「运行配置」），需登录。运行配置存在 SQLite（data/app.db）。
 

开发环节搭建
1 Windows只编译
1.1 服务端源码编译
   本机只要能编译。现成的就是：
   进入到源码目录 : 打开 powershell
   输入命令 :cd    盘符:\FlowOrderArbitrage
   进入目录后执行:
   npm install
   npm run build
   需要 Node 18+。编完得到 dist\（main.js 等）。
1.2 发布流程
   服务器系统选择 linux centos9。只改 scripts/install-env/arbitrage.conf 的 APP_ROOT。
   不要传 node_modules、不要传 data/app.db 到公共位置。

   首次（在服务器上）：
   1) 改 scripts/install-env/arbitrage.conf（APP_ROOT 建议 /opt/FlowOrderArbitrage）
   2) 把代码上传到 APP_ROOT
   3) sudo bash scripts/install-env/bootstrap.sh
      自动：装 Node 20、运行用户、防火墙 → apply-dist（登记服务 + npm + 启动）
   4) 浏览器打开 http://服务器IP:3780/ ，用 admin 登录后到「运行配置」填主/从节点
   日常启停：sudo bash  start.sh | restart.sh | stop.sh

   ---以后重新再发版---
   本机：powershell -ExecutionPolicy Bypass -File scripts\deploy-windows\build.ps1
   把生成的 dist-release\ 内容覆盖到服务器 APP_ROOT
   服务器：sudo bash scripts/install-env/apply-dist.sh（自动 npm 装依赖并重启）
   改密钥、间隔、从节点：查看页「运行配置」保存即可。

 1.5 开发环境搭建
   本机 Windows 改代码调试用这一节。和上面 1.1 / 1.2 的「只编译再上传 Linux」不是同一条路。

   前置：本机 Node 18+。
   打开 powershell，进入仓库根目录（有 src、package.json 的那一层），执行：
   npm install
   启动：
   npm run build
   npm start
   或直接：npx tsx src/main.ts
   浏览器打开：http://127.0.0.1:3780/ （默认端口，可在「运行配置」改）
   登录后到「运行配置」填主节点、从节点的地址和密钥。
   解析自测：npm run check

  
## 目录分工

| 目录 | 用途 |
|------|------|
| `src/` | 转发服务源码 |
| `public/` | 查看页（信号显示 / POST日志 / 运行配置） |
| `dist/` | 编译产物，Linux 上 `node dist/main.js` |
| `scripts/install-env/` | Linux 装环境、写 systemd、应用 dist |
| `data/app.db` | SQLite：账号、会话、运行配置（含密钥，不要提交） |

| 源码 | 用途 |
|------|------|
| `src/main.ts` | 入口：SQLite 配置、查看页 |
| `src/poller.ts` | 定时拉信号、去重、转发 |
| `src/store.ts` | 当前信号与 POST 记录（内存） |
| `src/web.ts` | 登录后 HTTP 查看页 |
| `src/hedge.ts` | 解析 `ETH_USDT_ba=ETH_PC_bac`、组 POST JSON |
| `src/mapi-client.ts` | 签名和 HTTP |
| `src/config-watcher.ts` | 运行配置读写（SQLite） |
| `src/auth.ts` | 登录、密码、SQLite |

## 运行配置

节点、密钥、间隔、查看页端口都在查看页「运行配置」里改，写入 `data/app.db`。 
至少确认：

- 主节点地址 — 拉信号，须 `http://IP:6686` 这种形式
- 主节点密钥 — 中间件 secretKey
- 从节点地址 / 密钥 — 可多个
- 拉取间隔 — 默认 `1000` 毫秒
- 查看页端口 — 默认 `3780`；`0` 表示不听

Linux 装环境仍改：`scripts/install-env/arbitrage.conf`（APP_ROOT / 运行用户 / 防火墙端口）

## 日常运维速查

| 场景 | 执行 |
|------|------|
| 本机装依赖 | `npm install` |
| Windows 本机编译 | `build.ps1`（生成 `dist-release\`） |
| Linux 首次一键 | `sudo bash  bootstrap.sh` |
| Linux 以后发版 | `sudo bash  apply-dist.sh`（自动 npm 装依赖并重启） |
| Linux 启停 | `sudo bash  start.sh` / `restart.sh` / `stop.sh` |
| 本机启动 | `npm start`（即 `node dist/main.js`） |
| 本机查看页 | 浏览器打开 `http://127.0.0.1:3780/`（`uiPort`） |
| 本机日志 | 仓库下 `logs\arb-当天日期.log`，例如 `logs\arb-2026-09-08.log` |
| 改间隔/节点/密钥 | 查看页「运行配置」，保存写回 SQLite，立刻生效 |
| 看是否在跑 | Linux：`systemctl status floworder-arbitrage`；本机看 `logs\` |
| 解析自测 | `npm run check` |

## 别搞混

| 项 | 作用 |
|----|------|
| `data/app.db` | 账号和运行配置（含密钥） |
| `bootstrap.sh` | 首次一键：装环境 + apply-dist |
| `install.sh` | 只装 Node、用户、防火墙 |
| `apply-dist.sh` | 登记 systemd、自动 npm 下载依赖并启动 |
| `build.ps1` | Windows 本机编译，生成 `dist-release\` |
| `npm start` | 用编译产物跑服务 |
| GET `/api/WorkingPairs` | 只向主节点拉当前组合 |
| POST `/api/BatchCreateRules` | 只向从节点批量启动 |
| `json=` | 表单字段名，HTTP 包体和 MD5 都要带 |
| `pollIntervalMs` | 拉信号间隔，默认 1000ms。查看页「运行配置」里改，立刻生效 |
| `uiPort` | 查看页端口，默认 3780，需登录 |
| USDT / PC | 结算币 `EqualCoinName`，去重用整条原文，两条不是同一个组合 |
