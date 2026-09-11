export type NodeEndpoint = {
  name?: string;
  base: string;
  secretKey: string;
};

export type AppConfig = {
  pollIntervalMs: number;
  /** 新组合从首次出现起，超过此时长不再转发 */
  signalTimeoutMs: number;
  requestTimeoutMs: number;
  /** 查看页端口；0 表示不听 */
  uiPort: number;
  endpoints: {
    /** 文档：GET /api/WorkingPairs */
    hedgeList: string;
    /** 文档：POST /api/BatchCreateRules */
    batchStart: string;
  };
  main: NodeEndpoint;
  targets: NodeEndpoint[];
};

export type HedgePair = {
  raw: string;
  CoinNameA: string;
  EqualCoinNameA: string;
  ApiCodeA: string;
  CoinNameB: string;
  EqualCoinNameB: string;
  ApiCodeB: string;
};

export const BATCH_DEFAULTS = {
  od: 0,
  dd: 0,
  nf: 0,
  cr: 0,
  vo: 0,
  DisableUseTemplate: '0',
  ExistedOnly: '0',
} as const;

export const POLL_INTERVAL_MIN_MS = 200;
export const POLL_INTERVAL_MAX_MS = 60_000;
export const DEFAULT_POLL_INTERVAL_MS = 1000;
export const DEFAULT_SIGNAL_TIMEOUT_MS = 10_000;
export const SIGNAL_TIMEOUT_MIN_MS = 200;
export const SIGNAL_TIMEOUT_MAX_MS = 300_000;
export const DEFAULT_HEDGE_LIST = 'api/WorkingPairs';
export const DEFAULT_BATCH_START = 'api/BatchCreateRules';
export const DEFAULT_UI_PORT = 3780;
