import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { log } from './logger';

const COOKIE_NAME = 'arb_sid';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_USER = 'admin';
const DEFAULT_PASSWORD = 'admin123';
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

type SqlStmt = {
  bind: (params: unknown[]) => void;
  step: () => boolean;
  getAsObject: () => Record<string, unknown>;
  free: () => void;
};

type SqlDb = {
  run: (sql: string, params?: unknown[]) => void;
  prepare: (sql: string) => SqlStmt;
  export: () => Uint8Array;
};

type SqlEngine = {
  Database: new (data?: ArrayLike<number>) => SqlDb;
};

export type AuthUser = {
  username: string;
  role: string;
};

function resolveVendorDir(): string {
  const here = path.join(__dirname, 'vendor');
  if (fs.existsSync(path.join(here, 'sql-wasm.js'))) return here;
  const fromNm = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist');
  if (fs.existsSync(path.join(fromNm, 'sql-wasm.js'))) return fromNm;
  throw new Error('找不到 sql.js（dist/vendor 或 node_modules/sql.js/dist）');
}

function loadEngine(): Promise<SqlEngine> {
  const vendorDir = resolveVendorDir();
  // sql-wasm.js 是 CJS 初始化函数
  const initSqlJs = require(path.join(vendorDir, 'sql-wasm.js')) as (opts: {
    locateFile: (file: string) => string;
  }) => Promise<SqlEngine>;
  return initSqlJs({ locateFile: (file) => path.join(vendorDir, file) });
}

function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${key.toString('hex')}`;
}

function verifyPassword(plain: string, stored: string): boolean {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'hex');
  const expect = Buffer.from(parts[5], 'hex');
  if (!salt.length || !expect.length) return false;
  const key = crypto.scryptSync(plain, salt, expect.length, { N, r, p });
  return crypto.timingSafeEqual(key, expect);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function sessionCookieHeader(token: string, maxAgeMs: number, secure: boolean): string {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookieHeader(secure: boolean): string {
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function isSecureRequest(req: {
  headers: { [key: string]: unknown };
  socket?: unknown;
}): boolean {
  const sock = req.socket as { encrypted?: boolean } | undefined;
  if (sock && sock.encrypted) return true;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return proto === 'https';
}

export function resolveDbPath(): string {
  const fromEnv = (process.env.AUTH_DB || process.env.DATA_DIR || '').trim();
  if (fromEnv) {
    const p = path.resolve(fromEnv);
    if (p.toLowerCase().endsWith('.db') || p.toLowerCase().endsWith('.sqlite')) return p;
    return path.join(p, 'app.db');
  }
  return path.resolve(process.cwd(), 'data', 'app.db');
}

export class AuthStore {
  readonly filePath: string;
  private db: SqlDb | null = null;

  constructor(filePath = resolveDbPath()) {
    this.filePath = filePath;
  }

  async init(): Promise<void> {
    const SQL = await loadEngine();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (fs.existsSync(this.filePath)) {
      const buf = fs.readFileSync(this.filePath);
      this.db = new SQL.Database(buf);
    } else {
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
      log.warn(`已创建管理员 ${DEFAULT_USER}，初始密码 ${DEFAULT_PASSWORD}，请登录后立即修改`);
    } else {
      this.persist();
    }
    this.purgeExpired();
    log.info(`账号库: ${this.filePath}`);
  }

  private requireDb(): SqlDb {
    if (!this.db) throw new Error('账号库未初始化');
    return this.db;
  }

  private applySchema(): void {
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

  private tableColumns(table: string): Set<string> {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
      throw new Error(`非法表名: ${table}`);
    }
    const stmt = this.requireDb().prepare(`PRAGMA table_info(${table})`);
    const names = new Set<string>();
    try {
      while (stmt.step()) {
        names.add(String(stmt.getAsObject().name || ''));
      }
    } finally {
      stmt.free();
    }
    return names;
  }

  private ensureColumns(table: string, cols: Array<[string, string]>): void {
    const existing = this.tableColumns(table);
    let changed = false;
    for (const [name, ddl] of cols) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new Error(`非法列名: ${name}`);
      }
      if (existing.has(name)) continue;
      this.requireDb().run(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
      existing.add(name);
      changed = true;
      log.info(`数据库已补列 ${table}.${name}`);
    }
    if (changed) this.persist();
  }

  private persist(): void {
    const db = this.requireDb();
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, Buffer.from(db.export()));
    fs.renameSync(tmp, this.filePath);
    try {
      fs.chmodSync(this.filePath, 0o600);
    } catch {
      /* Windows 可忽略 */
    }
  }

  private one(sql: string, params: unknown[] = []): Record<string, unknown> | null {
    const stmt = this.requireDb().prepare(sql);
    try {
      stmt.bind(params);
      if (!stmt.step()) return null;
      return stmt.getAsObject();
    } finally {
      stmt.free();
    }
  }

  private purgeExpired(): void {
    this.requireDb().run('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]);
    this.persist();
  }

  login(username: string, password: string): { token: string; user: AuthUser } | null {
    const u = String(username || '').trim();
    const p = String(password || '');
    if (!u || !p) return null;
    const row = this.one('SELECT username, password_hash, role FROM users WHERE username = ?', [u]);
    if (!row) return null;
    if (!verifyPassword(p, String(row.password_hash || ''))) return null;
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

  logout(token: string | null): void {
    if (!token) return;
    this.requireDb().run('DELETE FROM sessions WHERE token = ?', [token]);
    this.persist();
  }

  userFromToken(token: string | null): AuthUser | null {
    if (!token) return null;
    const row = this.one(
      'SELECT s.username AS username, u.role AS role FROM sessions s JOIN users u ON u.username = s.username WHERE s.token = ? AND s.expires_at > ?',
      [token, Date.now()],
    );
    if (!row) return null;
    return { username: String(row.username), role: String(row.role || 'admin') };
  }

  userFromCookieHeader(cookieHeader: string | undefined): AuthUser | null {
    const cookies = parseCookies(cookieHeader);
    return this.userFromToken(cookies[COOKIE_NAME] || null);
  }

  tokenFromCookieHeader(cookieHeader: string | undefined): string | null {
    return parseCookies(cookieHeader)[COOKIE_NAME] || null;
  }

  changePassword(username: string, oldPassword: string, newPassword: string): string | null {
    const u = String(username || '').trim();
    const oldP = String(oldPassword || '');
    const newP = String(newPassword || '');
    if (!u || !oldP) return '请填写当前密码';
    if (newP.length < 6) return '新密码至少 6 位';
    if (oldP === newP) return '新密码不能与当前密码相同';
    const row = this.one('SELECT username, password_hash FROM users WHERE username = ?', [u]);
    if (!row) return '用户不存在';
    if (!verifyPassword(oldP, String(row.password_hash || ''))) return '当前密码不正确';
    const now = new Date().toISOString();
    this.requireDb().run('UPDATE users SET password_hash = ?, updated_at = ? WHERE username = ?', [
      hashPassword(newP),
      now,
      u,
    ]);
    this.persist();
    return null;
  }

  sessionMaxAgeMs(): number {
    return SESSION_MS;
  }

  getConfigRaw(): unknown | null {
    const row = this.one('SELECT json FROM app_config WHERE id = 1');
    if (!row || row.json == null || row.json === '') return null;
    try {
      return JSON.parse(String(row.json));
    } catch {
      throw new Error('SQLite 中的配置 JSON 无效');
    }
  }

  saveConfigRaw(raw: unknown): void {
    const json = JSON.stringify(raw);
    const now = new Date().toISOString();
    const exists = this.one('SELECT id FROM app_config WHERE id = 1');
    if (exists) {
      this.requireDb().run('UPDATE app_config SET json = ?, updated_at = ? WHERE id = 1', [json, now]);
    } else {
      this.requireDb().run('INSERT INTO app_config (id, json, updated_at) VALUES (1, ?, ?)', [json, now]);
    }
    this.persist();
  }
}
