import * as crypto from 'crypto';
import { AppConfig } from './types';
import { log } from './logger';

export class MapiRequestError extends Error {
  statusCode: number;
  responseBody: unknown;
  url?: string;

  constructor(
    message: string,
    opts: { statusCode?: number; responseBody?: unknown; url?: string } = {},
  ) {
    super(message);
    this.name = 'MapiRequestError';
    this.statusCode = opts.statusCode ?? 0;
    this.responseBody = opts.responseBody ?? null;
    this.url = opts.url;
  }
}

export type SignParts = {
  queryString: string;
  requestBody: string;
  secretKey: string;
  concat: string;
  sign: string;
};

/** 文档: sign = MD5(AsciiSortedQueryString + RequestBody + SecretKey)，中间无分隔符 */
export function buildSignParts(
  query: Record<string, string>,
  body: string,
  secretKey: string,
): SignParts {
  const queryString = Object.keys(query)
    .filter((k) => k !== 'sign' && query[k] !== '')
    .sort()
    .map((k) => `${k}=${query[k]}`)
    .join('&');
  const requestBody = body ?? '';
  const concat = queryString + requestBody + secretKey;
  const sign = crypto.createHash('md5').update(concat, 'utf8').digest('hex');
  return { queryString, requestBody, secretKey, concat, sign };
}

export function signRequest(
  query: Record<string, string>,
  body: string,
  secretKey: string,
): string {
  return buildSignParts(query, body, secretKey).sign;
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

type Envelope = {
  ret?: number;
  msg?: string;
  message?: string;
  data?: unknown;
};

export async function mapiRequest<T = unknown>(opts: {
  cfg: AppConfig;
  base: string;
  secretKey: string;
  method: 'GET' | 'POST';
  path: string;
  /** POST 包体；MD5 RequestBody 默认与此相同（BatchCreateRules 为 json={...} 原文） */
  body?: string;
  /** 若与 HTTP 包体不同，单独指定签名原文；默认与 body 相同 */
  signBody?: string;
}): Promise<{ data: T; envelope: Envelope; statusCode: number; latencyMs: number }> {
  const timeoutMs = Math.max(1000, opts.cfg.requestTimeoutMs);
  const ts = String(Math.floor(Date.now() / 1000));
  const body = opts.method === 'POST' ? opts.body ?? '' : '';
  const signRaw = opts.method === 'POST' ? (opts.signBody ?? body) : '';
  const query = { ts };
  const parts = buildSignParts(query, signRaw, opts.secretKey);
  const sig = parts.sign;
  const url = `${joinUrl(opts.base, opts.path)}?ts=${encodeURIComponent(ts)}&sign=${sig}`;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let statusCode = 0;
  let responseBody: unknown = null;

  try {
    const res = await fetch(url, {
      method: opts.method,
      headers:
        opts.method === 'POST'
          ? { 'Content-Type': 'application/x-www-form-urlencoded' }
          : undefined,
      body: opts.method === 'POST' ? body : undefined,
      signal: controller.signal,
    });
    statusCode = res.status;
    const text = await res.text();
    if (!text) {
      responseBody = { message: `HTTP ${statusCode} (empty body)`, url };
    } else {
      try {
        responseBody = JSON.parse(text);
      } catch {
        throw new MapiRequestError(`响应不是 JSON: ${text.slice(0, 200)}`, {
          statusCode,
          responseBody: { raw: text.slice(0, 2000), url },
          url,
        });
      }
    }

    const env = (responseBody ?? {}) as Envelope;
    const httpOk = statusCode >= 200 && statusCode < 300;
    const bizOk = Number(env.ret) === 0;
    if (!(httpOk && bizOk)) {
      const msg = env.msg || env.message || `中间件错误 HTTP ${statusCode} ret=${env.ret}`;
      throw new MapiRequestError(String(msg), { statusCode, responseBody, url });
    }

    return {
      data: (env.data as T) ?? (null as T),
      envelope: env,
      statusCode,
      latencyMs: Date.now() - started,
    };
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string };
    if (e instanceof MapiRequestError) throw e;
    const msg =
      err?.name === 'AbortError'
        ? `请求超时 (${timeoutMs}ms)`
        : err?.message || String(e);
    log.warn(`mapi ${opts.method} ${url} 失败: ${msg}`);
    throw new MapiRequestError(msg, { statusCode, responseBody, url });
  } finally {
    clearTimeout(timer);
  }
}
