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
exports.MapiRequestError = void 0;
exports.buildSignParts = buildSignParts;
exports.signRequest = signRequest;
exports.mapiRequest = mapiRequest;
const crypto = __importStar(require("crypto"));
const logger_1 = require("./logger");
class MapiRequestError extends Error {
    constructor(message, opts = {}) {
        super(message);
        this.name = 'MapiRequestError';
        this.statusCode = opts.statusCode ?? 0;
        this.responseBody = opts.responseBody ?? null;
        this.url = opts.url;
    }
}
exports.MapiRequestError = MapiRequestError;
/** 文档: sign = MD5(AsciiSortedQueryString + RequestBody + SecretKey)，中间无分隔符 */
function buildSignParts(query, body, secretKey) {
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
function signRequest(query, body, secretKey) {
    return buildSignParts(query, body, secretKey).sign;
}
function joinUrl(base, path) {
    const b = base.replace(/\/$/, '');
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${b}${p}`;
}
async function mapiRequest(opts) {
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
    let responseBody = null;
    try {
        const res = await fetch(url, {
            method: opts.method,
            headers: opts.method === 'POST'
                ? { 'Content-Type': 'application/x-www-form-urlencoded' }
                : undefined,
            body: opts.method === 'POST' ? body : undefined,
            signal: controller.signal,
        });
        statusCode = res.status;
        const text = await res.text();
        if (!text) {
            responseBody = { message: `HTTP ${statusCode} (empty body)`, url };
        }
        else {
            try {
                responseBody = JSON.parse(text);
            }
            catch {
                throw new MapiRequestError(`响应不是 JSON: ${text.slice(0, 200)}`, {
                    statusCode,
                    responseBody: { raw: text.slice(0, 2000), url },
                    url,
                });
            }
        }
        const env = (responseBody ?? {});
        const httpOk = statusCode >= 200 && statusCode < 300;
        const bizOk = Number(env.ret) === 0;
        if (!(httpOk && bizOk)) {
            const msg = env.msg || env.message || `中间件错误 HTTP ${statusCode} ret=${env.ret}`;
            throw new MapiRequestError(String(msg), { statusCode, responseBody, url });
        }
        return {
            data: env.data ?? null,
            envelope: env,
            statusCode,
            latencyMs: Date.now() - started,
        };
    }
    catch (e) {
        const err = e;
        if (e instanceof MapiRequestError)
            throw e;
        const msg = err?.name === 'AbortError'
            ? `请求超时 (${timeoutMs}ms)`
            : err?.message || String(e);
        logger_1.log.warn(`mapi ${opts.method} ${url} 失败: ${msg}`);
        throw new MapiRequestError(msg, { statusCode, responseBody, url });
    }
    finally {
        clearTimeout(timer);
    }
}
//# sourceMappingURL=mapi-client.js.map