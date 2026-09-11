import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { ConfigWatcher, editorConfig, summarizeConfig } from './config-watcher';
import { log } from './logger';
import { HedgePoller } from './poller';
import { ViewStore } from './store';
import { AppConfig, POLL_INTERVAL_MAX_MS, POLL_INTERVAL_MIN_MS, DEFAULT_POLL_INTERVAL_MS } from './types';
import {
  AuthStore,
  AuthUser,
  clearSessionCookieHeader,
  isSecureRequest,
  parseCookies,
  sessionCookieHeader,
} from './auth';
import { CAPTCHA_COOKIE, CaptchaStore } from './captcha';

function resolveHtmlPath(): string | null {
  const names = [
    path.join(__dirname, 'public', 'index.html'),
    path.join(__dirname, '..', 'public', 'index.html'),
    path.join(process.cwd(), 'public', 'index.html'),
  ];
  for (const f of names) {
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
    ...(extraHeaders || {}),
  });
  res.end(text);
}

function sendText(
  res: http.ServerResponse,
  status: number,
  body: string,
  type: string,
  extraHeaders?: Record<string, string>,
): void {
  const payload = Buffer.from(body, 'utf8');
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Content-Length': payload.length,
    ...(extraHeaders || {}),
  });
  res.end(payload);
}

function parseOkParam(raw: string | null): boolean | undefined {
  if (raw == null || raw === '') return undefined;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return undefined;
}

function readBody(req: http.IncomingMessage, limit = 65536): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on('data', (c: Buffer) => {
      n += c.length;
      if (n > limit) {
        req.destroy();
        reject(new Error('请求体过大'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export class UiServer {
  private store: ViewStore;
  private watcher: ConfigWatcher;
  private poller: HedgePoller;
  private auth: AuthStore;
  private captcha = new CaptchaStore();
  private server: http.Server | null = null;
  private listeningPort = 0;
  private htmlPath: string | null;

  constructor(store: ViewStore, watcher: ConfigWatcher, poller: HedgePoller, auth: AuthStore) {
    this.store = store;
    this.watcher = watcher;
    this.poller = poller;
    this.auth = auth;
    this.htmlPath = resolveHtmlPath();
    watcher.on('reload', (next: AppConfig, prev: AppConfig) => {
      if (next.uiPort !== prev.uiPort) {
        log.info(`查看页端口 ${prev.uiPort} → ${next.uiPort}`);
        this.restart(next.uiPort);
      }
    });
  }

  start(): void {
    this.restart(this.watcher.get().uiPort);
  }

  stop(): void {
    if (!this.server) return;
    this.server.close();
    this.server = null;
    this.listeningPort = 0;
  }

  private restart(port: number): void {
    const prev = this.server;
    this.server = null;
    this.listeningPort = 0;
    const listen = (): void => {
      if (!port) {
        log.info('查看页未启用（uiPort=0）');
        return;
      }
      this.htmlPath = resolveHtmlPath();
      const server = http.createServer((req, res) => this.handle(req, res));
      server.on('error', (e: NodeJS.ErrnoException) => {
        log.error(`查看页监听失败 ${port}: ${e.message}`);
      });
      server.listen(port, '0.0.0.0', () => {
        this.listeningPort = port;
        log.info(`查看页已启动: http://127.0.0.1:${port}/ （需登录 admin）`);
      });
      this.server = server;
    };
    if (prev) {
      prev.close(() => listen());
      return;
    }
    listen();
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const method = (req.method || 'GET').toUpperCase();
    let url: URL;
    try {
      url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    } catch {
      sendJson(res, 400, { error: 'bad url' });
      return;
    }
    const p = url.pathname;
    const user = this.auth.userFromCookieHeader(req.headers.cookie);
    const isPublic =
      (method === 'GET' && (p === '/' || p === '/index.html' || p === '/api/me' || p === '/api/captcha')) ||
      (method === 'POST' && p === '/api/login');
    if (!isPublic && !user) {
      sendJson(res, 401, { ok: false, error: '未登录' });
      return;
    }

    if (method === 'POST') {
      if (p === '/api/login') {
        void this.handleLogin(req, res);
        return;
      }
      if (p === '/api/logout') {
        this.handleLogout(req, res);
        return;
      }
      if (p === '/api/account/password') {
        void this.handleChangePassword(req, res, user);
        return;
      }
      if (p === '/api/config') {
        void this.handleSaveConfig(req, res);
        return;
      }
      if (p === '/api/posts/clear') {
        this.store.clearPosts();
        sendJson(res, 200, { ok: true, recording: this.store.postRecording, total: 0 });
        return;
      }
      if (p === '/api/posts/recording') {
        void this.handlePostRecording(req, res);
        return;
      }
      if (p === '/api/signals/resend') {
        void this.handleResendSignal(req, res);
        return;
      }
      const m = /^\/api\/posts\/([^/]+)\/resend$/.exec(p);
      if (!m) {
        sendJson(res, 405, { error: 'method not allowed' });
        return;
      }
      void this.handleResend(res, decodeURIComponent(m[1]));
      return;
    }
    if (method !== 'GET') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }

    if (p === '/' || p === '/index.html') {
      this.serveHtml(res);
      return;
    }
    if (p === '/api/me') {
      if (!user) {
        sendJson(res, 401, { ok: false, error: '未登录' });
        return;
      }
      sendJson(res, 200, { ok: true, username: user.username, role: user.role });
      return;
    }
    if (p === '/api/captcha') {
      this.handleCaptcha(req, res);
      return;
    }
    if (p === '/api/signals') {
      sendJson(res, 200, {
        polledAt: this.store.lastPollAt,
        pairCount: this.store.pairCount,
        lastError: this.store.lastError,
        items: this.store.getSignals(),
      });
      return;
    }
    if (p === '/api/posts') {
      const skip = Number(url.searchParams.get('skip') || 0);
      const take = Number(url.searchParams.get('take') || 50);
      sendJson(res, 200, {
        lastError: this.store.lastError,
        recording: this.store.postRecording,
        ...this.store.listPosts({
          ok: parseOkParam(url.searchParams.get('ok')),
          q: url.searchParams.get('q') || '',
          skip: Number.isFinite(skip) ? skip : 0,
          take: Number.isFinite(take) ? take : 50,
        }),
      });
      return;
    }
    if (p.startsWith('/api/posts/')) {
      const id = decodeURIComponent(p.slice('/api/posts/'.length));
      const row = this.store.getPost(id);
      if (!row) {
        sendJson(res, 404, { error: 'not found' });
        return;
      }
      sendJson(res, 200, row);
      return;
    }
    if (p === '/api/status') {
      const cfg = this.watcher.get();
      sendJson(res, 200, {
        polledAt: this.store.lastPollAt,
        pairCount: this.store.pairCount,
        postCount: this.store.postCount(),
        recording: this.store.postRecording,
        lastError: this.store.lastError,
        uiPort: this.listeningPort || cfg.uiPort,
        config: summarizeConfig(cfg),
      });
      return;
    }
    if (p === '/api/config') {
      const cfg = this.watcher.get();
      sendJson(res, 200, {
        filePath: this.watcher.filePath,
        loadedAt: this.watcher.getLoadedAt(),
        config: summarizeConfig(cfg),
        editor: editorConfig(cfg),
        limits: {
          pollIntervalMs: { min: POLL_INTERVAL_MIN_MS, max: POLL_INTERVAL_MAX_MS, default: DEFAULT_POLL_INTERVAL_MS },
          requestTimeoutMs: { min: 1000, default: 15000 },
        },
      });
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  }

  private handleCaptcha(req: http.IncomingMessage, res: http.ServerResponse): void {
    const issued = this.captcha.issue();
    sendText(res, 200, issued.svg, 'image/svg+xml; charset=utf-8', {
      'Set-Cookie': this.captcha.cookieHeader(issued.id, isSecureRequest(req)),
    });
  }

  private async handleLogin(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const text = await readBody(req);
      const body = text
        ? (JSON.parse(text) as { username?: unknown; password?: unknown; captcha?: unknown })
        : {};
      const cid = parseCookies(req.headers.cookie)[CAPTCHA_COOKIE] || '';
      if (!this.captcha.consume(cid, String(body.captcha ?? ''))) {
        sendJson(res, 400, { ok: false, error: '验证码错误' });
        return;
      }
      const result = this.auth.login(String(body.username ?? ''), String(body.password ?? ''));
      if (!result) {
        sendJson(res, 401, { ok: false, error: '用户名或密码错误' });
        return;
      }
      sendJson(
        res,
        200,
        { ok: true, username: result.user.username, role: result.user.role },
        {
          'Set-Cookie': sessionCookieHeader(
            result.token,
            this.auth.sessionMaxAgeMs(),
            isSecureRequest(req),
          ),
        },
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      sendJson(res, 400, { ok: false, error: msg });
    }
  }

  private handleLogout(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.auth.logout(this.auth.tokenFromCookieHeader(req.headers.cookie));
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookieHeader(isSecureRequest(req)) });
  }

  private async handleChangePassword(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    user: AuthUser | null,
  ): Promise<void> {
    if (!user) {
      sendJson(res, 401, { ok: false, error: '未登录' });
      return;
    }
    try {
      const text = await readBody(req);
      const body = text ? (JSON.parse(text) as { oldPassword?: unknown; newPassword?: unknown }) : {};
      const err = this.auth.changePassword(
        user.username,
        String(body.oldPassword ?? ''),
        String(body.newPassword ?? ''),
      );
      if (err) {
        sendJson(res, 400, { ok: false, error: err });
        return;
      }
      sendJson(res, 200, { ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      sendJson(res, 400, { ok: false, error: msg });
    }
  }

  private async handlePostRecording(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const text = await readBody(req);
      const body = text ? (JSON.parse(text) as { recording?: unknown }) : {};
      this.store.setPostRecording(Boolean(body.recording));
      sendJson(res, 200, { ok: true, recording: this.store.postRecording, total: this.store.postCount() });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      sendJson(res, 400, { ok: false, error: msg });
    }
  }

  private async handleSaveConfig(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const text = await readBody(req);
      const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      const next = this.watcher.patchRuntime({
        pollIntervalMs: body.pollIntervalMs,
        requestTimeoutMs: body.requestTimeoutMs,
        uiPort: body.uiPort,
        main: body.main,
        targets: body.targets,
      });
      sendJson(res, 200, { ok: true, config: summarizeConfig(next), editor: editorConfig(next) });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      sendJson(res, 400, { ok: false, error: msg });
    }
  }

  private async handleResendSignal(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const text = await readBody(req);
      const body = text ? (JSON.parse(text) as { raw?: unknown }) : {};
      const result = await this.poller.resendSignal(String(body.raw ?? ''));
      sendJson(res, 200, { ok: true, sent: result.ok, fail: result.fail });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      sendJson(res, 400, { ok: false, error: msg });
    }
  }

  private async handleResend(res: http.ServerResponse, id: string): Promise<void> {
    try {
      const row = await this.poller.resendPost(id);
      sendJson(res, 200, { ok: true, row });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = msg.includes('找不到') ? 404 : 400;
      sendJson(res, status, { ok: false, error: msg });
    }
  }

  private serveHtml(res: http.ServerResponse): void {
    const file = this.htmlPath || resolveHtmlPath();
    if (!file) {
      sendText(
        res,
        500,
        '缺少 public/index.html，请把 public 目录放到程序旁边后重启。',
        'text/plain; charset=utf-8',
      );
      return;
    }
    try {
      const html = fs.readFileSync(file, 'utf8');
      sendText(res, 200, html, 'text/html; charset=utf-8');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      sendText(res, 500, `读取页面失败: ${msg}`, 'text/plain; charset=utf-8');
    }
  }
}
