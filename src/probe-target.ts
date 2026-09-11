import { loadRuntimeConfig } from './config-watcher';
import { mapiRequest, MapiRequestError, signRequest } from './mapi-client';
import { buildBatchStartBody, extractPairList } from './hedge';

function label(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

(async () => {
  const cfg = await loadRuntimeConfig();
  const t = cfg.targets[0];
  if (!t) {
    console.log('no target');
    return;
  }

  console.log('GET WorkingPairs on target');
  try {
    const r = await mapiRequest({
      cfg,
      base: t.base,
      secretKey: t.secretKey,
      method: 'GET',
      path: cfg.endpoints.hedgeList,
    });
    const pairs = extractPairList(r.data);
    console.log(`OK  HTTP ${r.statusCode}  ${r.latencyMs}ms  pairs=${pairs.length}`);
  } catch (e) {
    const err = e instanceof MapiRequestError ? e : null;
    console.log(`FAIL GET  HTTP ${err?.statusCode ?? 0}  ${label(e)}`);
  }

  const sample = extractPairList(['ETH_USDT_ba=ETH_PC_bac']);
  const jsonStr = buildBatchStartBody(sample);
  const bodies = [
    ['form-json=', `json=${jsonStr}`],
    ['raw-json', jsonStr],
    ['encoded-json=', `json=${encodeURIComponent(jsonStr)}`],
  ] as const;

  for (const [name, body] of bodies) {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signRequest({ ts }, body, t.secretKey);
    const url = `${t.base.replace(/\/$/, '')}/${cfg.endpoints.batchStart}?ts=${ts}&sign=${sig}`;
    const headers: Record<string, string> =
      name === 'raw-json'
        ? { 'Content-Type': 'application/json' }
        : { 'Content-Type': 'application/x-www-form-urlencoded' };
    try {
      const res = await fetch(url, { method: 'POST', headers, body });
      const text = await res.text();
      console.log(`${name}  HTTP ${res.status}  ${text.slice(0, 200)}`);
    } catch (e) {
      console.log(`${name}  ERR  ${label(e)}`);
    }
  }
})();
