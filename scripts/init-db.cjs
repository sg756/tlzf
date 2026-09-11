'use strict';
/** 首次安装：在 APP_ROOT 生成 data/app.db（管理员 + 默认运行配置）。已有库则只校验，不覆盖。 */
const fs = require('fs');
const path = require('path');

async function main() {
  const root = process.env.APP_ROOT
    ? path.resolve(process.env.APP_ROOT)
    : process.cwd();
  process.chdir(root);
  const authJs = path.join(root, 'dist', 'auth.js');
  const watcherJs = path.join(root, 'dist', 'config-watcher.js');
  if (!fs.existsSync(authJs)) {
    console.error('缺少 ' + authJs);
    process.exit(1);
  }
  const { AuthStore } = require(authJs);
  const { ConfigWatcher } = require(watcherJs);
  const auth = new AuthStore();
  await auth.init();
  new ConfigWatcher(auth);
  if (!fs.existsSync(auth.filePath)) {
    console.error('未能生成 ' + auth.filePath);
    process.exit(1);
  }
  console.log(auth.filePath);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
