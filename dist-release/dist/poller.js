"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HedgePoller = void 0;
const config_watcher_1 = require("./config-watcher");
const logger_1 = require("./logger");
const mapi_client_1 = require("./mapi-client");
const hedge_1 = require("./hedge");
class HedgePoller {
    constructor(watcher, store) {
        this.timer = null;
        this.running = false;
        this.lastEmptyLogAt = 0;
        /** targetBase + pairId → 已成功转发。进程内同一 key 不因离开列表而重发 */
        this.forwarded = new Set();
        this.stats = {
            lastPollAt: null,
            lastPairCount: 0,
            lastForwarded: 0,
            lastError: null,
            forwardedTotal: 0,
        };
        this.watcher = watcher;
        this.store = store;
        watcher.on('reload', (next, prev) => {
            if (next.pollIntervalMs !== prev.pollIntervalMs) {
                logger_1.log.info(`拉信号间隔 ${prev.pollIntervalMs}ms → ${next.pollIntervalMs}ms`);
                this.startTimer(next.pollIntervalMs);
            }
        });
    }
    start() {
        const cfg = this.watcher.get();
        logger_1.log.info('当前配置', (0, config_watcher_1.summarizeConfig)(cfg));
        this.startTimer(cfg.pollIntervalMs);
        void this.tick();
    }
    stop() {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
    }
    startTimer(ms) {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = setInterval(() => void this.tick(), ms);
        logger_1.log.info(`拉信号定时器已启动: ${ms}ms`);
    }
    async tick() {
        if (this.running)
            return;
        this.running = true;
        try {
            await this.pollAndForward();
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.stats.lastError = msg;
            this.store.setError(msg);
            logger_1.log.warn(`轮询异常: ${msg}`);
        }
        finally {
            this.running = false;
        }
    }
    async pollAndForward() {
        const cfg = this.watcher.get();
        if (!cfg.main.secretKey) {
            this.noteSkip('主节点 secretKey 为空，跳过');
            return;
        }
        const { data } = await (0, mapi_client_1.mapiRequest)({
            cfg,
            base: cfg.main.base,
            secretKey: cfg.main.secretKey,
            method: 'GET',
            path: cfg.endpoints.hedgeList,
        });
        const pairs = (0, hedge_1.extractPairList)(data);
        this.stats.lastPollAt = new Date().toISOString();
        this.stats.lastPairCount = pairs.length;
        this.stats.lastError = null;
        this.store.setPoll(this.stats.lastPollAt, pairs.length, null);
        this.store.setSignals(pairs, this.forwarded, cfg.targets);
        if (!pairs.length) {
            const now = Date.now();
            if (now - this.lastEmptyLogAt > 15_000) {
                this.lastEmptyLogAt = now;
                const preview = data == null
                    ? 'null'
                    : Array.isArray(data)
                        ? `array(${data.length})`
                        : typeof data === 'object'
                            ? `keys=${Object.keys(data).slice(0, 8).join(',')}`
                            : typeof data;
                logger_1.log.warn(`主节点未解析到对冲组合 (${preview})，请核对 endpoints.hedgeList`);
            }
            this.stats.lastForwarded = 0;
            return;
        }
        if (!cfg.targets.length) {
            this.stats.lastForwarded = 0;
            return;
        }
        const fresh = pairs.filter((p) => {
            const id = (0, hedge_1.pairIdentity)(p);
            return cfg.targets.some((t) => !this.forwarded.has(`${t.base}|${id}`));
        });
        if (!fresh.length) {
            this.stats.lastForwarded = 0;
            return;
        }
        const jsonStr = (0, hedge_1.buildBatchStartBody)(fresh);
        const rawList = fresh.map((p) => p.raw);
        const raws = rawList.join(',');
        let forwarded = 0;
        const results = await Promise.allSettled(cfg.targets.map(async (target, i) => {
            const name = target.name || `target-${i + 1}`;
            const started = Date.now();
            if (!target.secretKey) {
                this.store.addPost({
                    at: new Date().toISOString(),
                    targetName: name,
                    targetBase: target.base,
                    ok: false,
                    http: null,
                    ret: null,
                    msg: `${name} secretKey 为空`,
                    latencyMs: Date.now() - started,
                    pairCount: fresh.length,
                    raws: rawList,
                    body: `json=${jsonStr}`,
                    response: { message: `${name} secretKey 为空` },
                });
                throw new Error(`${name} secretKey 为空`);
            }
            try {
                const posted = await (0, mapi_client_1.mapiRequest)({
                    cfg,
                    base: target.base,
                    secretKey: target.secretKey,
                    method: 'POST',
                    path: cfg.endpoints.batchStart,
                    body: `json=${jsonStr}`,
                });
                for (const p of fresh) {
                    this.forwarded.add(`${target.base}|${(0, hedge_1.pairIdentity)(p)}`);
                }
                this.store.addPost({
                    at: new Date().toISOString(),
                    targetName: name,
                    targetBase: target.base,
                    ok: true,
                    http: posted.statusCode,
                    ret: posted.envelope.ret ?? 0,
                    msg: String(posted.envelope.msg || posted.envelope.message || 'success'),
                    latencyMs: posted.latencyMs,
                    pairCount: fresh.length,
                    raws: rawList,
                    body: `json=${jsonStr}`,
                    response: posted.envelope,
                });
                return posted.envelope;
            }
            catch (e) {
                const err = e instanceof mapi_client_1.MapiRequestError ? e : null;
                const env = err && err.responseBody && typeof err.responseBody === 'object'
                    ? err.responseBody
                    : null;
                this.store.addPost({
                    at: new Date().toISOString(),
                    targetName: name,
                    targetBase: target.base,
                    ok: false,
                    http: err?.statusCode ?? null,
                    ret: typeof env?.ret === 'number' ? env.ret : null,
                    msg: err?.message || (e instanceof Error ? e.message : String(e)),
                    latencyMs: Date.now() - started,
                    pairCount: fresh.length,
                    raws: rawList,
                    body: `json=${jsonStr}`,
                    response: err?.responseBody ?? (e instanceof Error ? e.message : String(e)),
                });
                throw e;
            }
        }));
        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            const name = cfg.targets[i].name || `target-${i + 1}`;
            if (r.status === 'fulfilled') {
                forwarded += 1;
                logger_1.log.info(`批量启动成功 ${name} 组合数=${fresh.length} 原文=${raws} 包体=json=${jsonStr} 返回=${JSON.stringify(r.value)}`);
            }
            else {
                const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
                const errUrl = r.reason && typeof r.reason === 'object' && 'url' in r.reason
                    ? String(r.reason.url || '')
                    : '';
                logger_1.log.warn(`批量启动失败 ${name} 组合数=${fresh.length} 原文=${raws} 包体=json=${jsonStr}: ${msg}${errUrl ? ` ${errUrl}` : ''}`);
                this.stats.lastError = `${name}: ${msg}`;
                this.store.setError(`${name}: ${msg}`);
            }
        }
        this.store.setSignals(pairs, this.forwarded, cfg.targets);
        this.stats.lastForwarded = forwarded;
        this.stats.forwardedTotal += forwarded;
    }
    /** 信号表手动重发：转发到全部从节点，并始终写入 POST 日志 */
    async resendSignal(raw) {
        const key = String(raw || '').trim();
        if (!key)
            throw new Error('原文为空');
        const fromStore = this.store.getSignals().find((s) => s.raw === key);
        const pair = fromStore || (0, hedge_1.parseWorkingPair)(key);
        if (!pair)
            throw new Error('无法解析这条组合');
        const cfg = this.watcher.get();
        if (!cfg.targets.length)
            throw new Error('从节点列表为空');
        const jsonStr = (0, hedge_1.buildBatchStartBody)([pair]);
        const rawList = [pair.raw];
        let ok = 0;
        let fail = 0;
        const results = await Promise.allSettled(cfg.targets.map(async (target, i) => {
            const name = target.name || `target-${i + 1}`;
            const started = Date.now();
            if (!target.secretKey) {
                this.store.addPost({
                    at: new Date().toISOString(),
                    targetName: name,
                    targetBase: target.base,
                    ok: false,
                    http: null,
                    ret: null,
                    msg: `${name} secretKey 为空`,
                    latencyMs: Date.now() - started,
                    pairCount: 1,
                    raws: rawList,
                    body: `json=${jsonStr}`,
                    response: { message: `${name} secretKey 为空` },
                }, { persist: true });
                throw new Error(`${name} secretKey 为空`);
            }
            try {
                const posted = await (0, mapi_client_1.mapiRequest)({
                    cfg,
                    base: target.base,
                    secretKey: target.secretKey,
                    method: 'POST',
                    path: cfg.endpoints.batchStart,
                    body: `json=${jsonStr}`,
                });
                this.forwarded.add(`${target.base}|${(0, hedge_1.pairIdentity)(pair)}`);
                this.store.addPost({
                    at: new Date().toISOString(),
                    targetName: name,
                    targetBase: target.base,
                    ok: true,
                    http: posted.statusCode,
                    ret: posted.envelope.ret ?? 0,
                    msg: String(posted.envelope.msg || posted.envelope.message || 'success'),
                    latencyMs: posted.latencyMs,
                    pairCount: 1,
                    raws: rawList,
                    body: `json=${jsonStr}`,
                    response: posted.envelope,
                }, { persist: true });
                return posted.envelope;
            }
            catch (e) {
                const err = e instanceof mapi_client_1.MapiRequestError ? e : null;
                const env = err && err.responseBody && typeof err.responseBody === 'object'
                    ? err.responseBody
                    : null;
                this.store.addPost({
                    at: new Date().toISOString(),
                    targetName: name,
                    targetBase: target.base,
                    ok: false,
                    http: err?.statusCode ?? null,
                    ret: typeof env?.ret === 'number' ? env.ret : null,
                    msg: err?.message || (e instanceof Error ? e.message : String(e)),
                    latencyMs: Date.now() - started,
                    pairCount: 1,
                    raws: rawList,
                    body: `json=${jsonStr}`,
                    response: err?.responseBody ?? (e instanceof Error ? e.message : String(e)),
                }, { persist: true });
                throw e;
            }
        }));
        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            const name = cfg.targets[i].name || `target-${i + 1}`;
            if (r.status === 'fulfilled') {
                ok += 1;
                logger_1.log.info(`手动重发成功 ${name} 原文=${pair.raw} 返回=${JSON.stringify(r.value)}`);
            }
            else {
                fail += 1;
                const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
                logger_1.log.warn(`手动重发失败 ${name} 原文=${pair.raw}: ${msg}`);
            }
        }
        this.store.setSignals(this.store.getSignals(), this.forwarded, cfg.targets);
        if (fail && !ok) {
            const msgs = results
                .filter((r) => r.status === 'rejected')
                .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
            throw new Error(msgs.join('；') || '重发失败');
        }
        return { ok, fail };
    }
    /** 用日志里的原包体再 POST 到同一从节点 */
    async resendPost(id) {
        const src = this.store.getPost(id);
        if (!src)
            throw new Error('找不到这条 POST 记录');
        if (!src.body)
            throw new Error('没有可重发的包体');
        const cfg = this.watcher.get();
        const target = cfg.targets.find((t) => t.base === src.targetBase) ||
            cfg.targets.find((t) => (t.name || '') === src.targetName);
        if (!target)
            throw new Error('从节点已不在当前配置中');
        const name = target.name || src.targetName;
        if (!target.secretKey)
            throw new Error(`${name} secretKey 为空`);
        const body = src.body.startsWith('json=') ? src.body : `json=${src.body}`;
        const started = Date.now();
        try {
            const posted = await (0, mapi_client_1.mapiRequest)({
                cfg,
                base: target.base,
                secretKey: target.secretKey,
                method: 'POST',
                path: cfg.endpoints.batchStart,
                body,
            });
            for (const raw of src.raws) {
                this.forwarded.add(`${target.base}|${raw}`);
            }
            const row = this.store.addPost({
                at: new Date().toISOString(),
                targetName: name,
                targetBase: target.base,
                ok: true,
                http: posted.statusCode,
                ret: posted.envelope.ret ?? 0,
                msg: String(posted.envelope.msg || posted.envelope.message || 'success'),
                latencyMs: posted.latencyMs,
                pairCount: src.pairCount,
                raws: src.raws,
                body,
                response: posted.envelope,
            }, { persist: true });
            this.store.setSignals(this.store.getSignals(), this.forwarded, cfg.targets);
            logger_1.log.info(`手动重发成功 ${name} 组合数=${src.pairCount} 原文=${src.raws.join(',')} 返回=${JSON.stringify(posted.envelope)}`);
            return row;
        }
        catch (e) {
            const err = e instanceof mapi_client_1.MapiRequestError ? e : null;
            const env = err && err.responseBody && typeof err.responseBody === 'object'
                ? err.responseBody
                : null;
            const msg = err?.message || (e instanceof Error ? e.message : String(e));
            const row = this.store.addPost({
                at: new Date().toISOString(),
                targetName: name,
                targetBase: target.base,
                ok: false,
                http: err?.statusCode ?? null,
                ret: typeof env?.ret === 'number' ? env.ret : null,
                msg,
                latencyMs: Date.now() - started,
                pairCount: src.pairCount,
                raws: src.raws,
                body,
                response: err?.responseBody ?? msg,
            }, { persist: true });
            logger_1.log.warn(`手动重发失败 ${name} 组合数=${src.pairCount} 原文=${src.raws.join(',')}: ${msg}`);
            const fail = new Error(msg);
            fail.row = row;
            throw fail;
        }
    }
    noteSkip(msg) {
        this.stats.lastError = msg;
        this.store.setError(msg);
        const now = Date.now();
        if (now - this.lastEmptyLogAt > 15_000) {
            this.lastEmptyLogAt = now;
            logger_1.log.warn(msg);
        }
    }
}
exports.HedgePoller = HedgePoller;
//# sourceMappingURL=poller.js.map