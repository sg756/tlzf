import { buildBatchStartBody, extractPairList, parseWorkingPair } from './hedge';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const p = parseWorkingPair('ETH_USDT_ba=ETH_PC_bac');
assert(p, 'parse');
assert(p!.CoinNameA === 'ETH' && p!.EqualCoinNameA === 'USDT' && p!.ApiCodeA === 'ba', 'long');
assert(p!.CoinNameB === 'ETH' && p!.EqualCoinNameB === 'PC' && p!.ApiCodeB === 'bac', 'short');
assert(p!.raw === 'ETH_USDT_ba=ETH_PC_bac', 'raw identity not swapped');

const zh = parseWorkingPair('牛来_PC_gtc=牛来_PC_bgu');
assert(zh!.CoinNameA === '牛来' && zh!.ApiCodeA === 'gtc', 'unicode coin');

const list = extractPairList(['ETH_USDT_ba=ETH_PC_bac', 'bad', 'BTC_PC_byu=BTC_PC_bac']);
assert(list.length === 2, 'extract strings');

const body = buildBatchStartBody(list);
assert(body.startsWith('{'), 'sign body is raw json');
assert(!body.startsWith('json='), 'sign body must not include json=');
const payload = JSON.parse(body) as {
  data: Array<{ CoinNameA: string; CoinNameB: string; od: number }>;
  DisableUseTemplate: string;
  ExistedOnly: string;
};
assert(payload.data[0].CoinNameA === 'ETH', 'A is long');
assert(payload.data[0].CoinNameB === 'ETH', 'B is short');
assert(payload.data[0].od === 0, 'od default');
assert(payload.DisableUseTemplate === '0' && payload.ExistedOnly === '0', 'flags');

console.log('hedge mapper ok');
