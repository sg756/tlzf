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
exports.CaptchaStore = exports.CAPTCHA_COOKIE = void 0;
const crypto = __importStar(require("crypto"));
const CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const TTL_MS = 5 * 60 * 1000;
exports.CAPTCHA_COOKIE = 'arb_cid';
function randInt(max) {
    return crypto.randomInt(0, max);
}
function pickText(n = 4) {
    let s = '';
    for (let i = 0; i < n; i++)
        s += CHARS[randInt(CHARS.length)];
    return s;
}
function escAttr(v) {
    return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function renderSvg(text) {
    const w = 148;
    const h = 44;
    const parts = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`);
    parts.push('<rect width="100%" height="100%" rx="8" fill="#0b1017"/>');
    for (let i = 0; i < 6; i++) {
        const x1 = randInt(w);
        const y1 = randInt(h);
        const x2 = randInt(w);
        const y2 = randInt(h);
        const c = randInt(2) ? '#3b82f6' : '#8b9bb0';
        parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${1 + randInt(2)}" opacity="0.35"/>`);
    }
    for (let i = 0; i < 18; i++) {
        const x = randInt(w);
        const y = randInt(h);
        parts.push(`<circle cx="${x}" cy="${y}" r="${1 + randInt(2)}" fill="#8b9bb0" opacity="0.35"/>`);
    }
    const step = w / (text.length + 0.6);
    for (let i = 0; i < text.length; i++) {
        const x = step * (i + 0.7);
        const y = 26 + randInt(8);
        const rot = randInt(36) - 18;
        const size = 20 + randInt(5);
        const fill = randInt(2) ? '#e8eef6' : '#93c5fd';
        parts.push(`<text x="${x.toFixed(1)}" y="${y}" fill="${fill}" font-size="${size}" font-weight="700" ` +
            `font-family="Consolas, 'Courier New', monospace" ` +
            `transform="rotate(${rot} ${x.toFixed(1)} ${y})" ` +
            `text-anchor="middle">${escAttr(text[i])}</text>`);
    }
    parts.push('</svg>');
    return parts.join('');
}
class CaptchaStore {
    constructor() {
        this.items = new Map();
    }
    issue() {
        this.purge();
        const id = crypto.randomBytes(16).toString('hex');
        const answer = pickText(4);
        this.items.set(id, { answer, exp: Date.now() + TTL_MS });
        return { id, svg: renderSvg(answer) };
    }
    consume(id, input) {
        this.purge();
        const key = String(id || '').trim();
        const got = String(input || '').trim().toUpperCase();
        const row = this.items.get(key);
        if (row)
            this.items.delete(key);
        if (!row || !got || row.exp < Date.now())
            return false;
        const a = Buffer.from(row.answer);
        const b = Buffer.from(got);
        if (a.length !== b.length)
            return false;
        return crypto.timingSafeEqual(a, b);
    }
    cookieHeader(id, secure) {
        const parts = [
            `${exports.CAPTCHA_COOKIE}=${encodeURIComponent(id)}`,
            'Path=/',
            'HttpOnly',
            'SameSite=Lax',
            'Max-Age=300',
        ];
        if (secure)
            parts.push('Secure');
        return parts.join('; ');
    }
    purge() {
        const now = Date.now();
        for (const [k, v] of this.items) {
            if (v.exp < now)
                this.items.delete(k);
        }
    }
}
exports.CaptchaStore = CaptchaStore;
//# sourceMappingURL=captcha.js.map