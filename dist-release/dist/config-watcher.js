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
exports.ConfigWatcher = void 0;
exports.validateConfig = validateConfig;
exports.defaultConfigRaw = defaultConfigRaw;
exports.editorConfig = editorConfig;
exports.summarizeConfig = summarizeConfig;
exports.loadRuntimeConfig = loadRuntimeConfig;
const events_1 = require("events");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const auth_1 = require("./auth");
const logger_1 = require("./logger");
const types_1 = require("./types");
function decodeConfigBuffer(buf) {
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
        throw new Error('配置文件是 UTF-16 LE，请改成 UTF-8 无 BOM');
    }
    if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
        throw new Error('配置文件是 UTF-16 BE，请改成 UTF-8 无 BOM');
    }
    let text = buf.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff)
        text = text.slice(1);
    return text.replace(/^\uFEFF/, '');
}
function normalizeBase(raw) {
    return String(raw || '')
        .trim()
        .replace(/\/$/, '');
}
function parseNode(raw, label) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error(`${label} 必须是对象`);
    }
    const o = raw;
    const base = normalizeBase(String(o.base ?? o.ip ?? o.url ?? ''));
    if (!base)
        throw new Error(`${label}.base 不能为空`);
    if (!/^https?:\/\//i.test(base)) {
        throw new Error(`${label}.base 需以 http:// 或 https:// 开头`);
    }
    const secretKey = String(o.secretKey ?? o.SecretKey ?? o.serviceKey ?? '').trim();
    const name = String(o.name ?? '').trim() || undefined;
    return { name, base, secretKey };
}
function validateConfig(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('配置根节点必须是 JSON 对象');
    }
    const o = raw;
    let pollIntervalMs = Number(o.pollIntervalMs ?? types_1.DEFAULT_POLL_INTERVAL_MS);
    if (!Number.isFinite(pollIntervalMs))
        pollIntervalMs = types_1.DEFAULT_POLL_INTERVAL_MS;
    pollIntervalMs = Math.floor(pollIntervalMs);
    if (pollIntervalMs < types_1.POLL_INTERVAL_MIN_MS)
        pollIntervalMs = types_1.POLL_INTERVAL_MIN_MS;
    if (pollIntervalMs > types_1.POLL_INTERVAL_MAX_MS)
        pollIntervalMs = types_1.POLL_INTERVAL_MAX_MS;
    let signalTimeoutMs = Number(o.signalTimeoutMs ?? types_1.DEFAULT_SIGNAL_TIMEOUT_MS);
    if (!Number.isFinite(signalTimeoutMs))
        signalTimeoutMs = types_1.DEFAULT_SIGNAL_TIMEOUT_MS;
    signalTimeoutMs = Math.floor(signalTimeoutMs);
    if (signalTimeoutMs < types_1.SIGNAL_TIMEOUT_MIN_MS)
        signalTimeoutMs = types_1.SIGNAL_TIMEOUT_MIN_MS;
    if (signalTimeoutMs > types_1.SIGNAL_TIMEOUT_MAX_MS)
        signalTimeoutMs = types_1.SIGNAL_TIMEOUT_MAX_MS;
    let requestTimeoutMs = Math.floor(Number(o.requestTimeoutMs ?? 15000));
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 1000) {
        requestTimeoutMs = 15000;
    }
    let uiPort = Math.floor(Number(o.uiPort ?? types_1.DEFAULT_UI_PORT));
    if (!Number.isFinite(uiPort) || uiPort < 0 || uiPort > 65535) {
        uiPort = types_1.DEFAULT_UI_PORT;
    }
    const epRaw = o.endpoints && typeof o.endpoints === 'object' && !Array.isArray(o.endpoints)
        ? o.endpoints
        : {};
    const endpoints = {
        hedgeList: String(epRaw.hedgeList || types_1.DEFAULT_HEDGE_LIST).replace(/^\//, ''),
        batchStart: String(epRaw.batchStart || types_1.DEFAULT_BATCH_START).replace(/^\//, ''),
    };
    const main = parseNode(o.main, 'main');
    const targetsRaw = Array.isArray(o.targets) ? o.targets : [];
    const targets = targetsRaw.map((t, i) => parseNode(t, `targets[${i}]`));
    return {
        pollIntervalMs,
        signalTimeoutMs,
        requestTimeoutMs,
        uiPort,
        endpoints,
        main,
        targets,
    };
}
/** 已有 JSON 缺了新版字段时写回 SQLite（多出来的旧字段下次保存时丢掉）。 */
function configNeedsBackfill(stored, shaped) {
    if (shaped && typeof shaped === 'object' && !Array.isArray(shaped)) {
        if (!stored || typeof stored !== 'object' || Array.isArray(stored))
            return true;
        const s = stored;
        const t = shaped;
        for (const k of Object.keys(t)) {
            if (!(k in s))
                return true;
            if (configNeedsBackfill(s[k], t[k]))
                return true;
        }
    }
    return false;
}
function persistShape(cfg) {
    return {
        pollIntervalMs: cfg.pollIntervalMs,
        signalTimeoutMs: cfg.signalTimeoutMs,
        requestTimeoutMs: cfg.requestTimeoutMs,
        uiPort: cfg.uiPort,
        endpoints: cfg.endpoints,
        main: {
            ...(cfg.main.name ? { name: cfg.main.name } : {}),
            base: cfg.main.base,
            secretKey: cfg.main.secretKey,
        },
        targets: cfg.targets.map((t) => ({
            ...(t.name ? { name: t.name } : {}),
            base: t.base,
            secretKey: t.secretKey,
        })),
    };
}
function defaultConfigRaw() {
    return {
        pollIntervalMs: types_1.DEFAULT_POLL_INTERVAL_MS,
        requestTimeoutMs: 15000,
        uiPort: types_1.DEFAULT_UI_PORT,
        endpoints: { hedgeList: types_1.DEFAULT_HEDGE_LIST, batchStart: types_1.DEFAULT_BATCH_START },
        main: { name: 'main', base: 'http://127.0.0.1:6686', secretKey: '' },
        targets: [],
    };
}
function maskKey(key) {
    const k = String(key || '');
    if (!k)
        return '(空)';
    if (k.length <= 8)
        return '****';
    return `${k.slice(0, 2)}****${k.slice(-4)}`;
}
function editorConfig(cfg) {
    return {
        pollIntervalMs: cfg.pollIntervalMs,
        requestTimeoutMs: cfg.requestTimeoutMs,
        uiPort: cfg.uiPort,
        main: {
            name: cfg.main.name || '',
            base: cfg.main.base,
            hasSecret: Boolean(cfg.main.secretKey),
        },
        targets: cfg.targets.map((t, i) => ({
            origIndex: i,
            name: t.name || '',
            base: t.base,
            hasSecret: Boolean(t.secretKey),
        })),
    };
}
function summarizeConfig(cfg) {
    return {
        pollIntervalMs: cfg.pollIntervalMs,
        signalTimeoutMs: cfg.signalTimeoutMs,
        requestTimeoutMs: cfg.requestTimeoutMs,
        uiPort: cfg.uiPort,
        endpoints: cfg.endpoints,
        main: { base: cfg.main.base, secretKey: maskKey(cfg.main.secretKey) },
        targets: cfg.targets.map((t, i) => ({
            name: t.name || `target-${i + 1}`,
            base: t.base,
            secretKey: maskKey(t.secretKey),
        })),
    };
}
function legacyConfigPath() {
    return path.resolve(process.cwd(), 'config.json');
}
function tryReadJsonFile(filePath) {
    if (!fs.existsSync(filePath))
        return null;
    const text = decodeConfigBuffer(fs.readFileSync(filePath));
    return JSON.parse(text);
}
function retireLegacyConfigFile(filePath) {
    const bak = `${filePath}.bak`;
    try {
        if (fs.existsSync(bak))
            fs.unlinkSync(bak);
        fs.renameSync(filePath, bak);
        logger_1.log.warn(`已将 ${filePath} 改为 ${bak}，配置改在查看页和 SQLite 里维护`);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger_1.log.warn(`配置已导入 SQLite，但未能改名 ${filePath}: ${msg}。该文件已不再使用，可手动删除`);
    }
}
/** CLI 探测脚本：读 SQLite 里的运行配置 */
async function loadRuntimeConfig() {
    const auth = new auth_1.AuthStore();
    await auth.init();
    return new ConfigWatcher(auth).get();
}
class ConfigWatcher extends events_1.EventEmitter {
    constructor(auth) {
        super();
        this.loadedAt = '';
        this.auth = auth;
        this.filePath = auth.filePath;
        this.current = this.loadInitial();
        this.loadedAt = new Date().toISOString();
    }
    get() {
        return this.current;
    }
    getLoadedAt() {
        return this.loadedAt;
    }
    /** 页面改运行参数 / 节点：写回 SQLite */
    patchRuntime(patch) {
        const raw = persistShape(this.current);
        const prevCfg = this.current;
        if (patch.pollIntervalMs !== undefined)
            raw.pollIntervalMs = patch.pollIntervalMs;
        if (patch.requestTimeoutMs !== undefined)
            raw.requestTimeoutMs = patch.requestTimeoutMs;
        if (patch.uiPort !== undefined)
            raw.uiPort = patch.uiPort;
        if (patch.main && typeof patch.main === 'object' && !Array.isArray(patch.main)) {
            const m = patch.main;
            const incoming = String(m.secretKey ?? '').trim();
            const name = String(m.name ?? '').trim();
            raw.main = {
                ...(name ? { name } : {}),
                base: String(m.base ?? ''),
                secretKey: incoming || prevCfg.main.secretKey,
            };
        }
        if (Array.isArray(patch.targets)) {
            raw.targets = patch.targets.map((item) => {
                if (!item || typeof item !== 'object' || Array.isArray(item)) {
                    throw new Error('从节点必须是对象');
                }
                const t = item;
                const orig = Number(t.origIndex);
                const keep = Number.isInteger(orig) && orig >= 0 && orig < prevCfg.targets.length
                    ? prevCfg.targets[orig].secretKey
                    : '';
                const incoming = String(t.secretKey ?? '').trim();
                const name = String(t.name ?? '').trim();
                return {
                    ...(name ? { name } : {}),
                    base: String(t.base ?? ''),
                    secretKey: incoming || keep,
                };
            });
        }
        const next = validateConfig(raw);
        const prev = this.current;
        this.auth.saveConfigRaw(persistShape(next));
        this.current = next;
        this.loadedAt = new Date().toISOString();
        logger_1.log.info('配置已保存 (页面)', summarizeConfig(next));
        this.emit('reload', next, prev);
        return next;
    }
    start() {
        logger_1.log.info(`配置已从 SQLite 加载: ${this.filePath}`);
    }
    stop() {
        /* SQLite 无文件监听 */
    }
    loadInitial() {
        const existing = this.auth.getConfigRaw();
        if (existing != null) {
            const cfg = validateConfig(existing);
            const shaped = persistShape(cfg);
            if (configNeedsBackfill(existing, shaped)) {
                this.auth.saveConfigRaw(shaped);
                logger_1.log.info('已把新增配置字段的默认值写入 SQLite');
            }
            return cfg;
        }
        const leftover = legacyConfigPath();
        const fromFile = tryReadJsonFile(leftover);
        if (fromFile != null) {
            const cfg = validateConfig(fromFile);
            this.auth.saveConfigRaw(persistShape(cfg));
            retireLegacyConfigFile(leftover);
            return cfg;
        }
        const cfg = validateConfig(defaultConfigRaw());
        this.auth.saveConfigRaw(persistShape(cfg));
        logger_1.log.warn('已写入默认配置到 SQLite，请在查看页「运行配置」填写主/从节点');
        return cfg;
    }
}
exports.ConfigWatcher = ConfigWatcher;
//# sourceMappingURL=config-watcher.js.map