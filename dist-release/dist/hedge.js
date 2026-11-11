"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseLeg = parseLeg;
exports.parseWorkingPair = parseWorkingPair;
exports.extractPairList = extractPairList;
exports.pairIdentity = pairIdentity;
exports.buildBatchStartBody = buildBatchStartBody;
const types_1 = require("./types");
/** ETH_USDT_ba → 币名 / 结算币 / 交易所。币名里若有下划线，归到前面。 */
function parseLeg(leg) {
    const parts = String(leg || '')
        .trim()
        .split('_')
        .filter(Boolean);
    if (parts.length < 3)
        return null;
    const ApiCode = parts[parts.length - 1];
    const EqualCoinName = parts[parts.length - 2];
    const CoinName = parts.slice(0, -2).join('_');
    if (!CoinName || !EqualCoinName || !ApiCode)
        return null;
    return { CoinName, EqualCoinName, ApiCode };
}
/**
 * 文档: "ETH_USDT_ba=ETH_PC_bac"，等号前多头、后空头。
 */
function parseWorkingPair(raw) {
    const s = String(raw || '').trim();
    const i = s.indexOf('=');
    if (i <= 0)
        return null;
    const long = parseLeg(s.slice(0, i));
    const short = parseLeg(s.slice(i + 1));
    if (!long || !short)
        return null;
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
function extractPairList(data) {
    if (!Array.isArray(data))
        return [];
    const out = [];
    for (const item of data) {
        if (typeof item !== 'string')
            continue;
        const p = parseWorkingPair(item);
        if (p)
            out.push(p);
    }
    return out;
}
function pairIdentity(item) {
    return item.raw;
}
/** BatchCreateRules：HTTP 与 MD5 都用 json={...} 原文。 */
function buildBatchStartBody(pairs) {
    const payload = {
        data: pairs.map((p) => ({
            CoinNameA: p.CoinNameA,
            EqualCoinNameA: p.EqualCoinNameA,
            ApiCodeA: p.ApiCodeA,
            CoinNameB: p.CoinNameB,
            EqualCoinNameB: p.EqualCoinNameB,
            ApiCodeB: p.ApiCodeB,
            od: types_1.BATCH_DEFAULTS.od,
            dd: types_1.BATCH_DEFAULTS.dd,
            nf: types_1.BATCH_DEFAULTS.nf,
            cr: types_1.BATCH_DEFAULTS.cr,
            vo: types_1.BATCH_DEFAULTS.vo,
        })),
        DisableUseTemplate: types_1.BATCH_DEFAULTS.DisableUseTemplate,
        ExistedOnly: types_1.BATCH_DEFAULTS.ExistedOnly,
    };
    return JSON.stringify(payload);
}
//# sourceMappingURL=hedge.js.map