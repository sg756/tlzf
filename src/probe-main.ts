/**
 * 只测主节点「收信号」：/api/Test + 配置里的 hedgeList，以及文档常见的获取对冲组合路径。
 * SecretKey 走 query，不用 FlowOrder 那套头。
 */
import * as crypto from 'crypto';
import { loadRuntimeConfig } from './config-watcher';
import { AppConfig } from './types';

function signHeaders(cfg: AppConfig): Record<string, string> {
  const language = 'zh-Hans';
  const nonce = crypto.randomUUID();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const versionCode = '20260012';
  const clientType = 'win';
  const raw = `${language}:${nonce}:${timestamp}:${versionCode}:${clientType}:${cfg.main.secretKey}`;
  const signature = crypto.createHash('md5').update(raw).digest('hex');
  return {
    'Content-Type': 'application/json',
    'X-Client-Language': language,
    'X-Client-Nonce': nonce,
    'X-Client-Timestamp': timestamp,
    'X-Client-VersionCode': versionCode,
    'X-Client-ClientType': clientType,
    'X-Client-Signature': signature,
    SecretKey: cfg.main.secretKey,
  };
}

async function hit(
  method: 'GET' | 'POST',
  url: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<void> {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
    const text = await res.text();
    const snip = text.replace(/\s+/g, ' ').slice(0, 300);
    console.log(
      `${res.ok ? 'OK  ' : 'FAIL'} ${method} ${url.replace(/secretKey=[^&]+/i, 'secretKey=***')}  HTTP ${res.status}  ${Date.now() - started}ms  ${snip || '(empty)'}`,
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`ERR  ${method} ${url}  ${Date.now() - started}ms  ${msg}`);
  }
}

(async () => {
  const cfg = await loadRuntimeConfig();
  const base = cfg.main.base.replace(/\/$/, '');
  const key = cfg.main.secretKey;
  const signed = signHeaders(cfg);
  const plain = { 'Content-Type': 'application/json', SecretKey: key };

  const paths = [
    'api/Test',
    cfg.endpoints.hedgeList,
    cfg.endpoints.hedgeList.replace(/^mapi\//, 'api/'),
    'api/GetHedgeGroupList',
    'api/HedgeGroupList',
    'api/GetHedgePairList',
    'api/HedgePairList',
  ];

  console.log(`base=${base}  hedgeList=${cfg.endpoints.hedgeList}`);
  console.log('--- signed GET ---');
  for (const p of paths) {
    const pathPart = p.replace(/^\//, '');
    await hit('GET', `${base}/${pathPart}?secretKey=${encodeURIComponent(key)}`, signed);
  }
  console.log('--- plain GET ---');
  await hit('GET', `${base}/api/Test`, plain);
  await hit(
    'GET',
    `${base}/api/HedgePairList?secretKey=${encodeURIComponent(key)}`,
    plain,
  );
  await hit(
    'GET',
    `${base}/api/GetHedgeGroupList?secretKey=${encodeURIComponent(key)}`,
    plain,
  );
})();
