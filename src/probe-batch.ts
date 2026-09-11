import { loadRuntimeConfig } from './config-watcher';
import { mapiRequest, signRequest } from './mapi-client';
import { buildBatchStartBody, extractPairList } from './hedge';
import * as crypto from 'crypto';

function md5(s: string): string {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex');
}

(async () => {
  const cfg = await loadRuntimeConfig();
  const t = cfg.targets[0];
  const fromMain = await mapiRequest<unknown>({
    cfg,
    base: cfg.main.base,
    secretKey: cfg.main.secretKey,
    method: 'GET',
    path: cfg.endpoints.hedgeList,
  });
  const pairs = extractPairList(fromMain.data).slice(0, 1);
  if (!pairs.length) {
    console.log('main 没有组合，无法组 BatchCreateRules');
    return;
  }
  console.log(`main pairs pulled, post 1: ${pairs[0].raw}`);
  const jsonObj = {
    data: [
      {
        CoinNameA: pairs[0].CoinNameA,
        EqualCoinNameA: pairs[0].EqualCoinNameA,
        ApiCodeA: pairs[0].ApiCodeA,
        CoinNameB: pairs[0].CoinNameB,
        EqualCoinNameB: pairs[0].EqualCoinNameB,
        ApiCodeB: pairs[0].ApiCodeB,
        od: 0,
        dd: 0,
        nf: 0,
        cr: 0,
        vo: 0,
      },
    ],
    DisableUseTemplate: '0',
    ExistedOnly: '0',
  };
  const jsonStr = JSON.stringify(jsonObj);
  const form = `json=${jsonStr}`;
  const formEnc = `json=${encodeURIComponent(jsonStr)}`;

  const cases: Array<{
    name: string;
    body: string;
    contentType: string;
    signRaw: string;
  }> = [
    { name: 'form + sign(form)', body: form, contentType: 'application/x-www-form-urlencoded', signRaw: form },
    { name: 'form + sign(json)', body: form, contentType: 'application/x-www-form-urlencoded', signRaw: jsonStr },
    { name: 'formEnc + sign(formEnc)', body: formEnc, contentType: 'application/x-www-form-urlencoded', signRaw: formEnc },
    { name: 'formEnc + sign(json)', body: formEnc, contentType: 'application/x-www-form-urlencoded', signRaw: jsonStr },
    { name: 'raw json + sign(json)', body: jsonStr, contentType: 'application/json', signRaw: jsonStr },
    { name: 'form + sign("")', body: form, contentType: 'application/x-www-form-urlencoded', signRaw: '' },
  ];

  const ts = String(Math.floor(Date.now() / 1000));
  for (const c of cases) {
    const sig = signRequest({ ts }, c.signRaw, t.secretKey);
    const url = `${t.base.replace(/\/$/, '')}/api/BatchCreateRules?ts=${ts}&sign=${sig}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': c.contentType },
      body: c.body,
    });
    const text = await res.text();
    console.log(`${c.name}  HTTP ${res.status}  ${text.slice(0, 180)}`);
  }

  const alt = md5(ts + form + t.secretKey);
  const url2 = `${t.base.replace(/\/$/, '')}/api/BatchCreateRules?ts=${ts}&sign=${alt}`;
  const res2 = await fetch(url2, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  console.log(`alt sign(ts+form+key)  HTTP ${res2.status}  ${(await res2.text()).slice(0, 180)}`);
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
