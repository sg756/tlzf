import * as crypto from 'crypto';

const CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const TTL_MS = 5 * 60 * 1000;
export const CAPTCHA_COOKIE = 'arb_cid';

type CaptchaEntry = { answer: string; exp: number };

function randInt(max: number): number {
  return crypto.randomInt(0, max);
}

function pickText(n = 4): string {
  let s = '';
  for (let i = 0; i < n; i++) s += CHARS[randInt(CHARS.length)];
  return s;
}

function escAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function renderSvg(text: string): string {
  const w = 148;
  const h = 44;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`);
  parts.push('<rect width="100%" height="100%" rx="8" fill="#0b1017"/>');
  for (let i = 0; i < 6; i++) {
    const x1 = randInt(w);
    const y1 = randInt(h);
    const x2 = randInt(w);
    const y2 = randInt(h);
    const c = randInt(2) ? '#3b82f6' : '#8b9bb0';
    parts.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${1 + randInt(2)}" opacity="0.35"/>`,
    );
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
    parts.push(
      `<text x="${x.toFixed(1)}" y="${y}" fill="${fill}" font-size="${size}" font-weight="700" ` +
        `font-family="Consolas, 'Courier New', monospace" ` +
        `transform="rotate(${rot} ${x.toFixed(1)} ${y})" ` +
        `text-anchor="middle">${escAttr(text[i])}</text>`,
    );
  }
  parts.push('</svg>');
  return parts.join('');
}

export class CaptchaStore {
  private items = new Map<string, CaptchaEntry>();

  issue(): { id: string; svg: string } {
    this.purge();
    const id = crypto.randomBytes(16).toString('hex');
    const answer = pickText(4);
    this.items.set(id, { answer, exp: Date.now() + TTL_MS });
    return { id, svg: renderSvg(answer) };
  }

  consume(id: string | null, input: string): boolean {
    this.purge();
    const key = String(id || '').trim();
    const got = String(input || '').trim().toUpperCase();
    const row = this.items.get(key);
    if (row) this.items.delete(key);
    if (!row || !got || row.exp < Date.now()) return false;
    const a = Buffer.from(row.answer);
    const b = Buffer.from(got);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  cookieHeader(id: string, secure: boolean): string {
    const parts = [
      `${CAPTCHA_COOKIE}=${encodeURIComponent(id)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=300',
    ];
    if (secure) parts.push('Secure');
    return parts.join('; ');
  }

  private purge(): void {
    const now = Date.now();
    for (const [k, v] of this.items) {
      if (v.exp < now) this.items.delete(k);
    }
  }
}
