import { AuthStore } from './auth';
import { ConfigWatcher } from './config-watcher';
import { initLogger, log } from './logger';
import { HedgePoller } from './poller';
import { ViewStore } from './store';
import { UiServer } from './web';

async function main(): Promise<void> {
  const logFile = initLogger();
  log.info(`日志文件: ${logFile}`);

  const auth = new AuthStore();
  await auth.init();

  const watcher = new ConfigWatcher(auth);
  watcher.start();

  const store = new ViewStore();
  const poller = new HedgePoller(watcher, store);
  const ui = new UiServer(store, watcher, poller, auth);
  ui.start();
  poller.start();

  const shutdown = () => {
    log.info('正在退出');
    poller.stop();
    ui.stop();
    watcher.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(msg);
  process.exit(1);
});
