import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';

let logDir = path.resolve(process.cwd(), 'logs');

export function initLogger(dir?: string): string {
  const fromEnv = (process.env.LOG_DIR || '').trim();
  logDir = path.resolve(dir || fromEnv || path.join(process.cwd(), 'logs'));
  fs.mkdirSync(logDir, { recursive: true });
  return currentLogFile();
}

export function currentLogFile(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return path.join(logDir, `arb-${y}-${m}-${day}.log`);
}

function ts(): string {
  return new Date().toISOString();
}

function formatExtra(extra: unknown): string {
  if (extra === undefined) return '';
  if (typeof extra === 'string') return ` ${extra}`;
  return ` ${util.inspect(extra, { depth: 6, breakLength: 200, compact: true })}`;
}

function write(level: string, msg: string, extra?: unknown): void {
  const line = `${ts()} [${level}] ${msg}${formatExtra(extra)}`;
  if (level === 'WARN') console.warn(line);
  else if (level === 'ERROR') console.error(line);
  else console.log(line);
  try {
    fs.appendFileSync(currentLogFile(), `${line}\n`, 'utf8');
  } catch {
    /* 写文件失败时仍保留控制台 */
  }
}

export const log = {
  info(msg: string, extra?: unknown) {
    write('INFO', msg, extra);
  },
  warn(msg: string, extra?: unknown) {
    write('WARN', msg, extra);
  },
  error(msg: string, extra?: unknown) {
    write('ERROR', msg, extra);
  },
};
