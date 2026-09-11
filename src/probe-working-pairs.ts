import * as crypto from 'crypto';
import { loadRuntimeConfig } from './config-watcher';

function asciiSortedQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => k !== 'sign' && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
}

function sign(query: Record<string, string>, body: string, secretKey: string): string {
  const raw = asciiSortedQuery(query) + body + secretKey;
  return crypto.createHash('md5').update(raw).digest('hex');
}

(async () => {
  const cfg = await loadRuntimeConfig();
  const main = cfg.main;
  const base = main.base.replace(/\/$/, '');
  const ts = String(Math.floor(Date.now() / 1000));
  const query = { ts };
  const body = '';
  const sig = sign(query, body, main.secretKey);
  const url = `${base}/api/WorkingPairs?ts=${encodeURIComponent(ts)}&sign=${sig}`;
  const started = Date.now();
  const res = await fetch(url, { method: 'GET' });
  const text = await res.text();
  console.log(`HTTP ${res.status}  ${Date.now() - started}ms`);
  console.log(text.slice(0, 4000));
})();
