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
exports.AuthStore = void 0;
exports.parseCookies = parseCookies;
exports.sessionCookieHeader = sessionCookieHeader;
exports.clearSessionCookieHeader = clearSessionCookieHeader;
exports.isSecureRequest = isSecureRequest;
exports.resolveDbPath = resolveDbPath;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("./logger");
const COOKIE_NAME = 'arb_sid';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_USER = 'admin';
const DEFAULT_PASSWORD = 'admin123';
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
function resolveVendorDir() {
    const here = path.join(__dirname, 'vendor');
    if (fs.existsSync(path.join(here, 'sql-wasm.js')))
        return here;
    const fromNm = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist');
    if (fs.existsSync(path.join(fromNm, 'sql-wasm.js')))
        return fromNm;
    throw new Error('找不到 sql.js（dist/vendor 或 node_modules/sql.js/dist）');
}
function loadEngine() {
    const vendorDir = resolveVendorDir();
    // sql-wasm.js 是 CJS 初始化函数
    const initSqlJs = require(path.join(vendorDir, 'sql-wasm.js'));
    return initSqlJs({ locateFile: (file) => path.join(vendorDir, file) });
}
function hashPassword(plain) {
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
    });
    return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${key.toString('hex')}`;
}
function verifyPassword(plain, stored) {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt')
        return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4], 'hex');
    const expect = Buffer.from(parts[5], 'hex');
    if (!salt.length || !expect.length)
        return false;
    const key = crypto.scryptSync(plain, salt, expect.length, { N, r, p });
    return crypto.timingSafeEqual(key, expect);
}
function parseCookies(header) {
    const out = {};
    for (const part of String(header || '').split(';')) {
        const i = part.indexOf('=');
        if (i <= 0)
            continue;
        const k = part.slice(0, i).trim();
        const v = part.slice(i + 1).trim();
        if (k)
            out[k] = decodeURIComponent(v);
    }
    return out;
}
function sessionCookieHeader(token, maxAgeMs, secure) {
    const parts = [
        `${COOKIE_NAME}=${encodeURIComponent(token)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`,
    ];
    if (secure)
        parts.push('Secure');
    return parts.join('; ');
}
function clearSessionCookieHeader(secure) {
    const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (secure)
        parts.push('Secure');
    return parts.join('; ');
}
function isSecureRequest(req) {
    const sock = req.socket;
    if (sock && sock.encrypted)
        return true;
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    return proto === 'https';
}
function resolveDbPath() {
    const fromEnv = (process.env.AUTH_DB || process.env.DATA_DIR || '').trim();
    if (fromEnv) {
        const p = path.resolve(fromEnv);
        if (p.toLowerCase().endsWith('.db') || p.toLowerCase().endsWith('.sqlite'))
            return p;
        return path.join(p, 'app.db');
    }
    return path.resolve(process.cwd(), 'data', 'app.db');
}
class AuthStore {
    constructor(filePath = resolveDbPath()) {
        this.db = null;
        this.filePath = filePath;
    }
    async init() {
        const SQL = await loadEngine();
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        if (fs.existsSync(this.filePath)) {
            const buf = fs.readFileSync(this.filePath);
            this.db = new SQL.Database(buf);
        }
        else {
            this.db = new SQL.Database();
        }
        this.applySchema();
        const row = this.one('SELECT username FROM users WHERE username = ?', [DEFAULT_USER]);
        if (!row) {
            const now = new Date().toISOString();
            this.db.run('INSERT INTO users (username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
                DEFAULT_USER,
                hashPassword(DEFAULT_PASSWORD),
                'admin',
                now,
                now,
            ]);
            this.persist();
            logger_1.log.warn(`已创建管理员 ${DEFAULT_USER}，初始密码 ${DEFAULT_PASSWORD}，请登录后立即修改`);
        }
        else {
            this.persist();
        }
        this.purgeExpired();
        logger_1.log.info(`账号库: ${this.filePath}`);
    }
    requireDb() {
        if (!this.db)
            throw new Error('账号库未初始化');
        return this.db;
    }
    applySchema() {
        const db = this.requireDb();
        db.run(`
      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
        db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
        db.run(`
      CREATE TABLE IF NOT EXISTS app_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
        this.ensureColumns('users', [
            ['password_hash', "TEXT NOT NULL DEFAULT ''"],
            ['role', "TEXT NOT NULL DEFAULT 'admin'"],
            ['created_at', "TEXT NOT NULL DEFAULT ''"],
            ['updated_at', "TEXT NOT NULL DEFAULT ''"],
        ]);
        this.ensureColumns('sessions', [
            ['username', "TEXT NOT NULL DEFAULT ''"],
            ['expires_at', 'INTEGER NOT NULL DEFAULT 0'],
        ]);
        this.ensureColumns('app_config', [
            ['json', "TEXT NOT NULL DEFAULT '{}'"],
            ['updated_at', "TEXT NOT NULL DEFAULT ''"],
        ]);
    }
    tableColumns(table) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
            throw new Error(`非法表名: ${table}`);
        }
        const stmt = this.requireDb().prepare(`PRAGMA table_info(${table})`);
        const names = new Set();
        try {
            while (stmt.step()) {
                names.add(String(stmt.getAsObject().name || ''));
            }
        }
        finally {
            stmt.free();
        }
        return names;
    }
    ensureColumns(table, cols) {
        const existing = this.tableColumns(table);
        let changed = false;
        for (const [name, ddl] of cols) {
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
                throw new Error(`非法列名: ${name}`);
            }
            if (existing.has(name))
                continue;
            this.requireDb().run(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
            existing.add(name);
            changed = true;
            logger_1.log.info(`数据库已补列 ${table}.${name}`);
        }
        if (changed)
            this.persist();
    }
    persist() {
        const db = this.requireDb();
        const tmp = `${this.filePath}.tmp`;
        fs.writeFileSync(tmp, Buffer.from(db.export()));
        fs.renameSync(tmp, this.filePath);
        try {
            fs.chmodSync(this.filePath, 0o600);
        }
        catch {
            /* Windows 可忽略 */
        }
    }
    one(sql, params = []) {
        const stmt = this.requireDb().prepare(sql);
        try {
            stmt.bind(params);
            if (!stmt.step())
                return null;
            return stmt.getAsObject();
        }
        finally {
            stmt.free();
        }
    }
    purgeExpired() {
        this.requireDb().run('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]);
        this.persist();
    }
    login(username, password) {
        const u = String(username || '').trim();
        const p = String(password || '');
        if (!u || !p)
            return null;
        const row = this.one('SELECT username, password_hash, role FROM users WHERE username = ?', [u]);
        if (!row)
            return null;
        if (!verifyPassword(p, String(row.password_hash || '')))
            return null;
        this.purgeExpired();
        const token = crypto.randomBytes(32).toString('hex');
        const expires = Date.now() + SESSION_MS;
        this.requireDb().run('INSERT INTO sessions (token, username, expires_at) VALUES (?, ?, ?)', [
            token,
            String(row.username),
            expires,
        ]);
        this.persist();
        return {
            token,
            user: { username: String(row.username), role: String(row.role || 'admin') },
        };
    }
    logout(token) {
        if (!token)
            return;
        this.requireDb().run('DELETE FROM sessions WHERE token = ?', [token]);
        this.persist();
    }
    userFromToken(token) {
        if (!token)
            return null;
        const row = this.one('SELECT s.username AS username, u.role AS role FROM sessions s JOIN users u ON u.username = s.username WHERE s.token = ? AND s.expires_at > ?', [token, Date.now()]);
        if (!row)
            return null;
        return { username: String(row.username), role: String(row.role || 'admin') };
    }
    userFromCookieHeader(cookieHeader) {
        const cookies = parseCookies(cookieHeader);
        return this.userFromToken(cookies[COOKIE_NAME] || null);
    }
    tokenFromCookieHeader(cookieHeader) {
        return parseCookies(cookieHeader)[COOKIE_NAME] || null;
    }
    changePassword(username, oldPassword, newPassword) {
        const u = String(username || '').trim();
        const oldP = String(oldPassword || '');
        const newP = String(newPassword || '');
        if (!u || !oldP)
            return '请填写当前密码';
        if (newP.length < 6)
            return '新密码至少 6 位';
        if (oldP === newP)
            return '新密码不能与当前密码相同';
        const row = this.one('SELECT username, password_hash FROM users WHERE username = ?', [u]);
        if (!row)
            return '用户不存在';
        if (!verifyPassword(oldP, String(row.password_hash || '')))
            return '当前密码不正确';
        const now = new Date().toISOString();
        this.requireDb().run('UPDATE users SET password_hash = ?, updated_at = ? WHERE username = ?', [
            hashPassword(newP),
            now,
            u,
        ]);
        this.persist();
        return null;
    }
    sessionMaxAgeMs() {
        return SESSION_MS;
    }
    getConfigRaw() {
        const row = this.one('SELECT json FROM app_config WHERE id = 1');
        if (!row || row.json == null || row.json === '')
            return null;
        try {
            return JSON.parse(String(row.json));
        }
        catch {
            throw new Error('SQLite 中的配置 JSON 无效');
        }
    }
    saveConfigRaw(raw) {
        const json = JSON.stringify(raw);
        const now = new Date().toISOString();
        const exists = this.one('SELECT id FROM app_config WHERE id = 1');
        if (exists) {
            this.requireDb().run('UPDATE app_config SET json = ?, updated_at = ? WHERE id = 1', [json, now]);
        }
        else {
            this.requireDb().run('INSERT INTO app_config (id, json, updated_at) VALUES (1, ?, ?)', [json, now]);
        }
        this.persist();
    }
}
exports.AuthStore = AuthStore;
//# sourceMappingURL=auth.js.map