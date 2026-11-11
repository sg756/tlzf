"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ViewStore = void 0;
const MAX_POSTS = 500;
function previewText(v, max = 180) {
    let s;
    if (v == null)
        s = '';
    else if (typeof v === 'string')
        s = v;
    else {
        try {
            s = JSON.stringify(v);
        }
        catch {
            s = String(v);
        }
    }
    if (s.length <= max)
        return s;
    return `${s.slice(0, max)}…`;
}
class ViewStore {
    constructor() {
        this.primed = false;
        this.signals = [];
        this.posts = [];
        this.seq = 0;
        this.lastPollAt = null;
        this.lastError = null;
        this.pairCount = 0;
        /** 默认不写 POST 日志，查看页勾选「记录」后才写入 */
        this.postRecording = false;
    }
    setError(msg) {
        this.lastError = msg;
    }
    setPoll(at, pairCount, error) {
        this.lastPollAt = at;
        this.pairCount = pairCount;
        this.lastError = error;
    }
    setSignals(pairs, forwarded, targets) {
        const now = new Date().toISOString();
        const prev = new Map(this.signals.map((s) => [s.raw, s]));
        const bases = targets.map((t) => t.base);
        this.signals = pairs.map((p) => {
            const old = prev.get(p.raw);
            const forwardedCount = bases.filter((b) => forwarded.has(`${b}|${p.raw}`)).length;
            return {
                ...p,
                seenAt: old?.seenAt || now,
                forwardedCount,
                targetCount: bases.length,
            };
        });
        this.signals.sort((a, b) => {
            const ta = Date.parse(a.seenAt) || 0;
            const tb = Date.parse(b.seenAt) || 0;
            if (tb !== ta)
                return tb - ta;
            return b.raw.localeCompare(a.raw);
        });
        this.primed = true;
        this.pairCount = pairs.length;
    }
    addPost(row, opts) {
        this.seq += 1;
        const full = { ...row, id: `${Date.now()}-${this.seq}` };
        const persist = opts?.persist ?? this.postRecording;
        if (!persist)
            return full;
        this.posts.unshift(full);
        if (this.posts.length > MAX_POSTS)
            this.posts.length = MAX_POSTS;
        return full;
    }
    clearPosts() {
        this.posts = [];
    }
    setPostRecording(on) {
        this.postRecording = Boolean(on);
    }
    getSignals() {
        return this.signals;
    }
    getPost(id) {
        return this.posts.find((p) => p.id === id) || null;
    }
    listPosts(opts) {
        const q = (opts.q || '').trim().toLowerCase();
        let rows = this.posts;
        if (opts.ok === true)
            rows = rows.filter((p) => p.ok);
        else if (opts.ok === false)
            rows = rows.filter((p) => !p.ok);
        if (q) {
            rows = rows.filter((p) => {
                const blob = `${p.targetName} ${p.targetBase} ${p.msg} ${p.raws.join(' ')} ${p.body}`.toLowerCase();
                return blob.includes(q);
            });
        }
        const skip = Math.max(0, opts.skip ?? 0);
        const take = Math.min(200, Math.max(1, opts.take ?? 50));
        const page = rows.slice(skip, skip + take);
        return {
            total: rows.length,
            items: page.map((p) => ({
                id: p.id,
                at: p.at,
                targetName: p.targetName,
                targetBase: p.targetBase,
                ok: p.ok,
                http: p.http,
                ret: p.ret,
                msg: p.msg,
                latencyMs: p.latencyMs,
                pairCount: p.pairCount,
                raws: p.raws,
                rawPreview: previewText(p.raws.join(', '), 160),
                responsePreview: previewText(p.response ?? p.msg, 120),
            })),
        };
    }
    postCount() {
        return this.posts.length;
    }
}
exports.ViewStore = ViewStore;
//# sourceMappingURL=store.js.map