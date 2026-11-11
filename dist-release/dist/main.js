"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const auth_1 = require("./auth");
const config_watcher_1 = require("./config-watcher");
const logger_1 = require("./logger");
const poller_1 = require("./poller");
const store_1 = require("./store");
const web_1 = require("./web");
async function main() {
    const logFile = (0, logger_1.initLogger)();
    logger_1.log.info(`日志文件: ${logFile}`);
    const auth = new auth_1.AuthStore();
    await auth.init();
    const watcher = new config_watcher_1.ConfigWatcher(auth);
    watcher.start();
    const store = new store_1.ViewStore();
    const poller = new poller_1.HedgePoller(watcher, store);
    const ui = new web_1.UiServer(store, watcher, poller, auth);
    ui.start();
    poller.start();
    const shutdown = () => {
        logger_1.log.info('正在退出');
        poller.stop();
        ui.stop();
        watcher.stop();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}
void main().catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(msg);
    process.exit(1);
});
//# sourceMappingURL=main.js.map