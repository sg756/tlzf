import { HedgePair, NodeEndpoint } from './types';

export type SignalRow = HedgePair & {
  seenAt: string;
  forwardedCount: number;
  targetCount: number;
};

export type PostLogRow = {
  id: string;
  at: string;
  targetName: string;
  targetBase: string;
  ok: boolean;
  http: number | null;
  ret: number | null;
  msg: string;
  latencyMs: number | null;
  pairCount: number;
  raws: string[];
  body: string;
  response: unknown;
};

export type PostLogListItem = Omit<PostLogRow, 'body' | 'response'> & {
  rawPreview: string;
  responsePreview: string;
};

const MAX_POSTS = 500;

function previewText(v: unknown, max = 180): string {
  let s: string;
  if (v == null) s = '';
  else if (typeof v === 'string') s = v;
  else {
    try {
      s = JSON.stringify(v);
    } catch {
      s = String(v);
    }
  }
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

export class ViewStore {
  private primed = false;
  private signals: SignalRow[] = [];
  private posts: PostLogRow[] = [];
  private seq = 0;
  lastPollAt: string | null = null;
  lastError: string | null = null;
  pairCount = 0;
  /** 默认不写 POST 日志，查看页勾选「记录」后才写入 */
  postRecording = false;

  setError(msg: string | null): void {
    this.lastError = msg;
  }

  setPoll(at: string, pairCount: number, error: string | null): void {
    this.lastPollAt = at;
    this.pairCount = pairCount;
    this.lastError = error;
  }

  setSignals(pairs: HedgePair[], forwarded: Set<string>, targets: NodeEndpoint[]): void {
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
      if (tb !== ta) return tb - ta;
      return b.raw.localeCompare(a.raw);
    });
    this.primed = true;
    this.pairCount = pairs.length;
  }

  addPost(row: Omit<PostLogRow, 'id'>, opts?: { persist?: boolean }): PostLogRow {
    this.seq += 1;
    const full: PostLogRow = { ...row, id: `${Date.now()}-${this.seq}` };
    const persist = opts?.persist ?? this.postRecording;
    if (!persist) return full;
    this.posts.unshift(full);
    if (this.posts.length > MAX_POSTS) this.posts.length = MAX_POSTS;
    return full;
  }

  clearPosts(): void {
    this.posts = [];
  }

  setPostRecording(on: boolean): void {
    this.postRecording = Boolean(on);
  }

  getSignals(): SignalRow[] {
    return this.signals;
  }

  getPost(id: string): PostLogRow | null {
    return this.posts.find((p) => p.id === id) || null;
  }

  listPosts(opts: {
    ok?: boolean;
    q?: string;
    skip?: number;
    take?: number;
  }): { total: number; items: PostLogListItem[] } {
    const q = (opts.q || '').trim().toLowerCase();
    let rows = this.posts;
    if (opts.ok === true) rows = rows.filter((p) => p.ok);
    else if (opts.ok === false) rows = rows.filter((p) => !p.ok);
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

  postCount(): number {
    return this.posts.length;
  }
}
