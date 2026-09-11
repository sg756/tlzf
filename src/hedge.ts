import { BATCH_DEFAULTS, HedgePair } from './types';

/** ETH_USDT_ba → 币名 / 结算币 / 交易所。币名里若有下划线，归到前面。 */
export function parseLeg(leg: string): {
  CoinName: string;
  EqualCoinName: string;
  ApiCode: string;
} | null {
  const parts = String(leg || '')
    .trim()
    .split('_')
    .filter(Boolean);
  if (parts.length < 3) return null;
  const ApiCode = parts[parts.length - 1];
  const EqualCoinName = parts[parts.length - 2];
  const CoinName = parts.slice(0, -2).join('_');
  if (!CoinName || !EqualCoinName || !ApiCode) return null;
  return { CoinName, EqualCoinName, ApiCode };
}

/**
 * 文档: "ETH_USDT_ba=ETH_PC_bac"，等号前多头、后空头。
 */
export function parseWorkingPair(raw: string): HedgePair | null {
  const s = String(raw || '').trim();
  const i = s.indexOf('=');
  if (i <= 0) return null;
  const long = parseLeg(s.slice(0, i));
  const short = parseLeg(s.slice(i + 1));
  if (!long || !short) return null;
  return {
    raw: s,
    CoinNameA: long.CoinName,
    EqualCoinNameA: long.EqualCoinName,
    ApiCodeA: long.ApiCode,
    CoinNameB: short.CoinName,
    EqualCoinNameB: short.EqualCoinName,
    ApiCodeB: short.ApiCode,
  };
}

export function extractPairList(data: unknown): HedgePair[] {
  if (!Array.isArray(data)) return [];
  const out: HedgePair[] = [];
  for (const item of data) {
    if (typeof item !== 'string') continue;
    const p = parseWorkingPair(item);
    if (p) out.push(p);
  }
  return out;
}

export function pairIdentity(item: HedgePair): string {
  return item.raw;
}

/** BatchCreateRules：HTTP 与 MD5 都用 json={...} 原文。 */
export function buildBatchStartBody(pairs: HedgePair[]): string {
  const payload = {
    data: pairs.map((p) => ({
      CoinNameA: p.CoinNameA,
      EqualCoinNameA: p.EqualCoinNameA,
      ApiCodeA: p.ApiCodeA,
      CoinNameB: p.CoinNameB,
      EqualCoinNameB: p.EqualCoinNameB,
      ApiCodeB: p.ApiCodeB,
      od: BATCH_DEFAULTS.od,
      dd: BATCH_DEFAULTS.dd,
      nf: BATCH_DEFAULTS.nf,
      cr: BATCH_DEFAULTS.cr,
      vo: BATCH_DEFAULTS.vo,
    })),
    DisableUseTemplate: BATCH_DEFAULTS.DisableUseTemplate,
    ExistedOnly: BATCH_DEFAULTS.ExistedOnly,
  };
  return JSON.stringify(payload);
}
