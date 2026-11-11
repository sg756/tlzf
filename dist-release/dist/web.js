"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.UiServer = void 0;
const fs = __importStar(require("fs"));
const http = __importStar(require("http"));
const path = __importStar(require("path"));
const config_watcher_1 = require("./config-watcher");
const logger_1 = require("./logger");
const types_1 = require("./types");
const auth_1 = require("./auth");
const captcha_1 = require("./captcha");
function resolveHtmlPath() {
    const names = [
        path.join(__dirname, 'public', 'index.html'),
        path.join(__dirname, '..', 'public', 'index.html'),
        path.join(process.cwd(), 'public', 'index.html'),
    ];
    for (const f of names) {
        if (fs.existsSync(f))
            return f;
    }
    return null;
}
function sendJson(res, status, body, extraHeaders) {
    const text = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(text),
        ...(extraHeaders || {}),
    });
    res.end(text);
}
function sendText(res, status, body, type, extraHeaders) {
    const payload = Buffer.from(body, 'utf8');
    res.writeHead(status, {
        'Content-Type': type,
        'Cache-Control': 'no-store',
        'Content-Length': payload.length,
        ...(extraHeaders || {}),
    });
    res.end(payload);
}
function parseOkParam(raw) {
    if (raw == null || raw === '')
        return undefined;
    if (raw === '1' || raw === 'true')
        return true;
    if (raw === '0' || raw === 'false')
        return false;
    return undefined;
}
function readBody(req, limit = 65536) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let n = 0;
        req.on('data', (c) => {
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
class UiServer {
    constructor(store, watcher, poller, auth) {
        this.captcha = new captcha_1.CaptchaStore();
        this.server = null;
        this.listeningPort = 0;
        this.store = store;
        this.watcher = watcher;
        this.poller = poller;
        this.auth = auth;
        this.htmlPath = resolveHtmlPath();
        watcher.on('reload', (next, prev) => {
            if (next.uiPort !== prev.uiPort) {
                logger_1.log.info(`查看页端口 ${prev.uiPort} → ${next.uiPort}`);
                this.restart(next.uiPort);
            }
        });
    }
    start() {
        this.restart(this.watcher.get().uiPort);
    }
    stop() {
        if (!this.server)
            return;
        this.server.close();
        this.server = null;
        this.listeningPort = 0;
    }
    restart(port) {
        const prev = this.server;
        this.server = null;
        this.listeningPort = 0;
        const listen = () => {
            if (!port) {
                logger_1.log.info('查看页未启用（uiPort=0）');
                return;
            }
            this.htmlPath = resolveHtmlPath();
            const server = http.createServer((req, res) => this.handle(req, res));
            server.on('error', (e) => {
                logger_1.log.error(`查看页监听失败 ${port}: ${e.message}`);
            });
            server.listen(port, '0.0.0.0', () => {
                this.listeningPort = port;
                logger_1.log.info(`查看页已启动: http://127.0.0.1:${port}/ （需登录 admin）`);
            });
            this.server = server;
        };
        if (prev) {
            prev.close(() => listen());
            return;
        }
        listen();
    }
    handle(req, res) {
        const method = (req.method || 'GET').toUpperCase();
        let url;
        try {
            url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
        }
        catch {
            sendJson(res, 400, { error: 'bad url' });
            return;
        }
        const p = url.pathname;
        const user = this.auth.userFromCookieHeader(req.headers.cookie);
        const isPublic = (method === 'GET' && (p === '/' || p === '/index.html' || p === '/api/me' || p === '/api/captcha')) ||
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
                config: (0, config_watcher_1.summarizeConfig)(cfg),
            });
            return;
        }
        if (p === '/api/config') {
            const cfg = this.watcher.get();
            sendJson(res, 200, {
                filePath: this.watcher.filePath,
                loadedAt: this.watcher.getLoadedAt(),
                config: (0, config_watcher_1.summarizeConfig)(cfg),
                editor: (0, config_watcher_1.editorConfig)(cfg),
                limits: {
                    pollIntervalMs: { min: types_1.POLL_INTERVAL_MIN_MS, max: types_1.POLL_INTERVAL_MAX_MS, default: types_1.DEFAULT_POLL_INTERVAL_MS },
                    requestTimeoutMs: { min: 1000, default: 15000 },
                },
            });
            return;
        }
        sendJson(res, 404, { error: 'not found' });
    }
    handleCaptcha(req, res) {
        const issued = this.captcha.issue();
        sendText(res, 200, issued.svg, 'image/svg+xml; charset=utf-8', {
            'Set-Cookie': this.captcha.cookieHeader(issued.id, (0, auth_1.isSecureRequest)(req)),
        });
    }
    async handleLogin(req, res) {
        try {
            const text = await readBody(req);
            const body = text
                ? JSON.parse(text)
                : {};
            const cid = (0, auth_1.parseCookies)(req.headers.cookie)[captcha_1.CAPTCHA_COOKIE] || '';
            if (!this.captcha.consume(cid, String(body.captcha ?? ''))) {
                sendJson(res, 400, { ok: false, error: '验证码错误' });
                return;
            }
            const result = this.auth.login(String(body.username ?? ''), String(body.password ?? ''));
            if (!result) {
                sendJson(res, 401, { ok: false, error: '用户名或密码错误' });
                return;
            }
            sendJson(res, 200, { ok: true, username: result.user.username, role: result.user.role }, {
                'Set-Cookie': (0, auth_1.sessionCookieHeader)(result.token, this.auth.sessionMaxAgeMs(), (0, auth_1.isSecureRequest)(req)),
            });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            sendJson(res, 400, { ok: false, error: msg });
        }
    }
    handleLogout(req, res) {
        this.auth.logout(this.auth.tokenFromCookieHeader(req.headers.cookie));
        sendJson(res, 200, { ok: true }, { 'Set-Cookie': (0, auth_1.clearSessionCookieHeader)((0, auth_1.isSecureRequest)(req)) });
    }
    async handleChangePassword(req, res, user) {
        if (!user) {
            sendJson(res, 401, { ok: false, error: '未登录' });
            return;
        }
        try {
            const text = await readBody(req);
            const body = text ? JSON.parse(text) : {};
            const err = this.auth.changePassword(user.username, String(body.oldPassword ?? ''), String(body.newPassword ?? ''));
            if (err) {
                sendJson(res, 400, { ok: false, error: err });
                return;
            }
            sendJson(res, 200, { ok: true });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            sendJson(res, 400, { ok: false, error: msg });
        }
    }
    async handlePostRecording(req, res) {
        try {
            const text = await readBody(req);
            const body = text ? JSON.parse(text) : {};
            this.store.setPostRecording(Boolean(body.recording));
            sendJson(res, 200, { ok: true, recording: this.store.postRecording, total: this.store.postCount() });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            sendJson(res, 400, { ok: false, error: msg });
        }
    }
    async handleSaveConfig(req, res) {
        try {
            const text = await readBody(req);
            const body = text ? JSON.parse(text) : {};
            const next = this.watcher.patchRuntime({
                pollIntervalMs: body.pollIntervalMs,
                requestTimeoutMs: body.requestTimeoutMs,
                uiPort: body.uiPort,
                main: body.main,
                targets: body.targets,
            });
            sendJson(res, 200, { ok: true, config: (0, config_watcher_1.summarizeConfig)(next), editor: (0, config_watcher_1.editorConfig)(next) });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            sendJson(res, 400, { ok: false, error: msg });
        }
    }
    async handleResendSignal(req, res) {
        try {
            const text = await readBody(req);
            const body = text ? JSON.parse(text) : {};
            const result = await this.poller.resendSignal(String(body.raw ?? ''));
            sendJson(res, 200, { ok: true, sent: result.ok, fail: result.fail });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            sendJson(res, 400, { ok: false, error: msg });
        }
    }
    async handleResend(res, id) {
        try {
            const row = await this.poller.resendPost(id);
            sendJson(res, 200, { ok: true, row });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            const status = msg.includes('找不到') ? 404 : 400;
            sendJson(res, status, { ok: false, error: msg });
        }
    }
    serveHtml(res) {
        const file = this.htmlPath || resolveHtmlPath();
        if (!file) {
            sendText(res, 500, '缺少 public/index.html，请把 public 目录放到程序旁边后重启。', 'text/plain; charset=utf-8');
            return;
        }
        try {
            const html = fs.readFileSync(file, 'utf8');
            sendText(res, 200, html, 'text/html; charset=utf-8');
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            sendText(res, 500, `读取页面失败: ${msg}`, 'text/plain; charset=utf-8');
        }
    }
}
exports.UiServer = UiServer;
//# sourceMappingURL=web.js.map