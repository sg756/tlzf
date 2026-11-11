"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_UI_PORT = exports.DEFAULT_BATCH_START = exports.DEFAULT_HEDGE_LIST = exports.SIGNAL_TIMEOUT_MAX_MS = exports.SIGNAL_TIMEOUT_MIN_MS = exports.DEFAULT_SIGNAL_TIMEOUT_MS = exports.DEFAULT_POLL_INTERVAL_MS = exports.POLL_INTERVAL_MAX_MS = exports.POLL_INTERVAL_MIN_MS = exports.BATCH_DEFAULTS = void 0;
exports.BATCH_DEFAULTS = {
    od: 0,
    dd: 0,
    nf: 0,
    cr: 0,
    vo: 0,
    DisableUseTemplate: '0',
    ExistedOnly: '0',
};
exports.POLL_INTERVAL_MIN_MS = 200;
exports.POLL_INTERVAL_MAX_MS = 60_000;
exports.DEFAULT_POLL_INTERVAL_MS = 1000;
exports.DEFAULT_SIGNAL_TIMEOUT_MS = 10_000;
exports.SIGNAL_TIMEOUT_MIN_MS = 200;
exports.SIGNAL_TIMEOUT_MAX_MS = 300_000;
exports.DEFAULT_HEDGE_LIST = 'api/WorkingPairs';
exports.DEFAULT_BATCH_START = 'api/BatchCreateRules';
exports.DEFAULT_UI_PORT = 3780;
//# sourceMappingURL=types.js.map