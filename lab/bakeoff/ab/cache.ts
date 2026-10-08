// A/B response cache (8 Oct): every outside call (OpenAI chat, streams, image generation and edits,
// embeddings, Pexels and Commons search, photo downloads) goes through one fetch wrapper. A call is
// keyed by the sha256 of its method, URL and exact body (sorted keys; data URLs and uploaded files by
// their own sha), so the model id, every parameter, system, user, schema and images are all in the
// key. Only an exact key is ever served: never a near match. See ab/CACHE.md.
//
// Reads are scoped: by default a run reads nothing (fresh calls). `--replay <run>` serves only that
// run's recorded responses, in the order they were made (the n-th call of a key gets the run's n-th
// response), so unchanged stages replay at $0 and any stage whose compiled request changed is called
// fresh. Every call a run makes is logged with its full request and response under
// <runDir>/calls.jsonl + <runDir>/calls/, so every new run is itself replayable.
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

export const CACHE_DIR = `${import.meta.dir}/cache`;
const sha = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");

/** What our own chat wrappers know about a call before localising (importers and stage labels read it). */
export type CallMeta = {
  name?: string;
  model?: string;
  effort?: string;
  system?: string;
  user?: string;
  schema?: unknown;
};
export const callMeta = new AsyncLocalStorage<CallMeta>();

/** Data URLs longer than this are hashed out of the key form (and kept as blobs). */
const DATA_MIN = 256;

/** The body's key form: sorted keys, long data URLs as `sha256:<hex>` (their bytes go to `blobs`). */
export function canonical(v: unknown, blobs?: Map<string, Uint8Array>): unknown {
  if (typeof v === "string") {
    if (v.length > DATA_MIN && v.startsWith("data:")) {
      const h = sha(v);
      blobs?.set(h, new TextEncoder().encode(v));
      return `sha256:${h}`;
    }
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => canonical(x, blobs));
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort())
      o[k] = canonical((v as Record<string, unknown>)[k], blobs);
    return o;
  }
  return v;
}

export type ReqForm = { method: string; url: string; body: unknown };
export const requestKey = (r: ReqForm) => sha(JSON.stringify(r));

/** Reads a fetch call's method, URL and body into its key form (FormData files by sha). */
export async function requestForm(
  input: string | URL | Request,
  init: RequestInit | undefined,
  blobs: Map<string, Uint8Array>,
): Promise<ReqForm> {
  const req = input instanceof Request ? input : undefined;
  const url = req ? req.url : String(input);
  const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
  let raw: unknown = init?.body ?? (req?.body ? await req.clone().text() : undefined);
  let body: unknown = null;
  if (typeof raw === "string") {
    try {
      body = { json: canonical(JSON.parse(raw), blobs) };
    } catch {
      body = { text: raw };
    }
  } else if (raw instanceof FormData) {
    const parts: unknown[] = [];
    for (const [k, v0] of raw.entries()) {
      const v = v0 as unknown;
      if (typeof v === "string") parts.push([k, v]);
      else {
        const f = v as File;
        const bytes = new Uint8Array(await f.arrayBuffer());
        const h = sha(bytes);
        blobs.set(h, bytes);
        parts.push([k, { file: `sha256:${h}`, type: f.type, name: f.name ?? null }]);
      }
    }
    body = { form: parts };
  } else if (raw instanceof URLSearchParams) body = { text: raw.toString() };
  else if (raw instanceof Uint8Array || raw instanceof ArrayBuffer) {
    const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw;
    const h = sha(bytes);
    blobs.set(h, bytes);
    body = { bytes: `sha256:${h}` };
  } else if (raw != null) throw new Error(`cache: unsupported request body ${typeof raw}`);
  raw = undefined;
  return { method, url, body };
}

/** One stored response. */
export type Stored = {
  status: number;
  contentType: string;
  bodySha: string;
  /** What the call cost when it was made (USD). */
  usd: number;
  usage?: unknown;
};

/** Every number under a `usage` object set to 0 (a served hit books no spend in any caller). */
function zeroed(u: unknown): unknown {
  if (typeof u === "number") return 0;
  if (Array.isArray(u)) return u.map(zeroed);
  if (u && typeof u === "object")
    return Object.fromEntries(Object.entries(u).map(([k, v]) => [k, zeroed(v)]));
  return u;
}
/** The usage a body reports (JSON, or an SSE stream's last usage chunk). */
export function usageOf(text: string, contentType: string): unknown {
  if (contentType.includes("event-stream")) {
    let u: unknown;
    for (const l of text.split("\n")) {
      const d = l.trim().startsWith("data:") ? l.trim().slice(5).trim() : "";
      if (!d || d === "[DONE]") continue;
      try {
        const j = JSON.parse(d);
        if (j?.usage) u = j.usage;
      } catch {}
    }
    return u;
  }
  if (contentType.includes("json"))
    try {
      return JSON.parse(text)?.usage;
    } catch {}
  return undefined;
}
/** The body with its usage zeroed (JSON or SSE); other bodies unchanged. */
export function zeroUsage(text: string, contentType: string): string {
  if (contentType.includes("event-stream"))
    return text
      .split("\n")
      .map((l) => {
        const t = l.trim();
        if (!t.startsWith("data:") || !t.includes('"usage"')) return l;
        try {
          const j = JSON.parse(t.slice(5).trim());
          if (!j?.usage) return l;
          return `data: ${JSON.stringify({ ...j, usage: zeroed(j.usage) })}`;
        } catch {
          return l;
        }
      })
      .join("\n");
  if (contentType.includes("json"))
    try {
      const j = JSON.parse(text);
      if (j && typeof j === "object" && j.usage)
        return JSON.stringify({ ...j, usage: zeroed(j.usage) });
    } catch {}
  return text;
}

/** A best-effort importer for an old run's logs: the response to an exact compiled request, or none. */
export type Imported = { text: string; contentType: string; usd: number; verify: string };
export type Importer = (r: { form: ReqForm; meta?: CallMeta }) => Imported | undefined;

export type CacheOpts = {
  /** This lesson's run dir: calls.jsonl and calls/ (requests and responses) are written here. */
  runDir: string;
  /** Responses this run may serve, per key in call order (from `--replay`, or the store with --cache-any). */
  source?: Map<string, Stored[]>;
  /** Where `source` blobs live (a replayed run's calls/blobs, or the store's). */
  sourceBlobs?: string[];
  /** A miss is refused (throws) instead of calling out: proves a $0 run. */
  offline?: boolean;
  importers?: Importer[];
  /** The cost of a fresh call from its request and reported usage (USD). */
  price?: (form: ReqForm, usage: unknown) => number;
  /** Hosts never cached (the local web and API). */
  local?: (url: string) => boolean;
  storeDir?: string;
};

export type CacheStats = {
  made: number;
  cached: number;
  imported: number;
  refused: number;
  failed: number;
  spentUsd: number;
  savedUsd: number;
  byStage: Record<string, { made: number; cached: number; savedUsd: number; spentUsd: number }>;
};

/** One run's cache: a fetch to install as globalThis.fetch, and its stats. */
export function createCache(o: CacheOpts, realFetch: typeof fetch = globalThis.fetch) {
  const store = o.storeDir ?? CACHE_DIR;
  const callsDir = `${o.runDir}/calls`;
  for (const d of [`${store}/blobs`, `${store}/requests`, `${store}/entries`, `${callsDir}/blobs`])
    mkdirSync(d, { recursive: true });
  const seen = new Map<string, number>();
  const pending: Promise<unknown>[] = [];
  const stats: CacheStats = {
    made: 0,
    cached: 0,
    imported: 0,
    refused: 0,
    failed: 0,
    spentUsd: 0,
    savedUsd: 0,
    byStage: {},
  };
  const local = o.local ?? ((u: string) => /^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u));
  const putBlob = (h: string, bytes: Uint8Array | string) => {
    for (const d of [`${store}/blobs`, `${callsDir}/blobs`])
      if (!existsSync(`${d}/${h}`)) writeFileSync(`${d}/${h}`, bytes);
  };
  const readBlob = (h: string) => {
    for (const d of [...(o.sourceBlobs ?? []), `${store}/blobs`, `${callsDir}/blobs`])
      if (existsSync(`${d}/${h}`)) return readFileSync(`${d}/${h}`);
    return undefined;
  };
  const stageOf = (form: ReqForm, meta?: CallMeta) => {
    const j = (form.body as { json?: Record<string, unknown> } | null)?.json;
    const rf = j?.response_format as { json_schema?: { name?: string } } | undefined;
    return (
      meta?.name ?? rf?.json_schema?.name ?? new URL(form.url).hostname + new URL(form.url).pathname
    );
  };
  const book = (stage: string, k: "made" | "cached", usd: number) => {
    stats.byStage[stage] ??= { made: 0, cached: 0, savedUsd: 0, spentUsd: 0 };
    const s = stats.byStage[stage];
    s[k] += 1;
    if (k === "cached") s.savedUsd += usd;
    else s.spentUsd += usd;
  };
  const record = (line: object) =>
    appendFileSync(`${o.runDir}/calls.jsonl`, `${JSON.stringify(line)}\n`);
  const keep = (
    key: string,
    form: ReqForm,
    blobs: Map<string, Uint8Array>,
    s: Stored,
    from: string,
  ) => {
    for (const [h, b] of blobs) putBlob(h, b);
    const req = JSON.stringify(form);
    if (!existsSync(`${store}/requests/${key}.json`))
      writeFileSync(`${store}/requests/${key}.json`, req);
    if (!existsSync(`${callsDir}/${key}.req.json`))
      writeFileSync(`${callsDir}/${key}.req.json`, req);
    appendFileSync(
      `${store}/entries/${key}.jsonl`,
      `${JSON.stringify({ ...s, from, at: Date.now() })}\n`,
    );
  };
  const served = (s: Stored, text: string) => {
    const h = new Headers({
      "content-type": s.contentType,
      "x-ab-cache": "hit",
      "x-ab-cache-usd": String(s.usd),
      "x-ab-cache-usage": JSON.stringify(s.usage ?? null),
    });
    return new Response(zeroUsage(text, s.contentType), { status: s.status, headers: h });
  };

  const cachedFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (local(url)) return realFetch(input as never, init);
    const meta = callMeta.getStore();
    const blobs = new Map<string, Uint8Array>();
    const form = await requestForm(input, init, blobs);
    const key = requestKey(form);
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    const stage = stageOf(form, meta);
    const base = { key, n, method: form.method, url: form.url.replace(/[?#].*$/, ""), stage };
    // 1. The replayed run's response for this exact key, in call order.
    const hit = o.source?.get(key)?.[n];
    const hitText = hit ? readBlob(hit.bodySha)?.toString("utf8") : undefined;
    if (hit && hitText !== undefined) {
      keep(key, form, blobs, hit, "replay");
      putBlob(hit.bodySha, hitText);
      stats.cached += 1;
      stats.savedUsd += hit.usd;
      book(stage, "cached", hit.usd);
      record({
        ...base,
        cached: true,
        from: "replay",
        status: hit.status,
        usd: hit.usd,
        contentType: hit.contentType,
        bodySha: hit.bodySha,
        usage: hit.usage,
      });
      return served(hit, hitText);
    }
    // 2. An old run's logs (importer), only for a request it can tie to that run exactly.
    for (const imp of o.importers ?? []) {
      const got = imp({ form, meta });
      if (!got) continue;
      const bodySha = sha(got.text);
      const s: Stored = {
        status: 200,
        contentType: got.contentType,
        bodySha,
        usd: got.usd,
        usage: usageOf(got.text, got.contentType),
      };
      putBlob(bodySha, got.text);
      keep(key, form, blobs, s, `import:${got.verify}`);
      stats.cached += 1;
      stats.imported += 1;
      stats.savedUsd += got.usd;
      book(stage, "cached", got.usd);
      record({
        ...base,
        cached: true,
        from: "import",
        verify: got.verify,
        status: 200,
        usd: got.usd,
        contentType: got.contentType,
        bodySha,
        usage: s.usage,
      });
      return served(s, got.text);
    }
    // 3. A fresh call (refused when offline).
    if (o.offline) {
      stats.refused += 1;
      record({ ...base, cached: false, refused: true });
      throw new Error(`cache: offline and no recorded response for ${stage} (${form.url})`);
    }
    const res = await realFetch(input as never, init);
    const contentType = res.headers.get("content-type") ?? "";
    const finish = (bytes: Uint8Array) => {
      const text = new TextDecoder().decode(bytes);
      const usage = usageOf(text, contentType);
      const usd = res.ok ? (o.price?.(form, usage) ?? 0) : 0;
      const bodySha = sha(bytes);
      const s: Stored = { status: res.status, contentType, bodySha, usd, usage };
      if (res.ok) {
        putBlob(bodySha, bytes);
        keep(key, form, blobs, s, o.runDir);
        stats.made += 1;
        stats.spentUsd += usd;
        book(stage, "made", usd);
      } else stats.failed += 1;
      record({
        ...base,
        cached: false,
        from: "api",
        status: res.status,
        usd,
        contentType,
        bodySha,
        usage,
      });
    };
    if (!res.body) {
      finish(new Uint8Array());
      return res;
    }
    // Teed: the caller reads its branch as it arrives (streams keep their pace); ours is stored.
    const [mine, theirs] = res.body.tee();
    pending.push(
      new Response(mine)
        .arrayBuffer()
        .then((b) => finish(new Uint8Array(b)))
        .catch((e) =>
          record({ ...base, cached: false, from: "api", error: String(e).slice(0, 200) }),
        ),
    );
    return new Response(theirs, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  };
  /** Waits for every fresh call's body to be stored (before the summary is written). */
  const drain = async () => {
    for (let k = 0; k < pending.length; k = pending.length) await Promise.all(pending.slice(k));
  };
  return { fetch: cachedFetch as typeof fetch, stats, drain };
}

/** A lesson dir's recorded calls (calls.jsonl), as a replay source: per key, ok responses in call order. */
export function loadRun(lessonDir: string): Map<string, Stored[]> | undefined {
  const f = `${lessonDir}/calls.jsonl`;
  if (!existsSync(f)) return undefined;
  const m = new Map<string, Stored[]>();
  for (const l of readFileSync(f, "utf8").split("\n")) {
    if (!l.trim()) continue;
    const c = JSON.parse(l);
    if (!c.bodySha || c.status < 200 || c.status >= 300 || c.refused) continue;
    const list = m.get(c.key) ?? [];
    list.push({
      status: c.status,
      contentType: c.contentType,
      bodySha: c.bodySha,
      usd: c.usd ?? 0,
      usage: c.usage,
    });
    m.set(c.key, list);
  }
  return m;
}

/** Every stored response in the store (`--cache-any`): per key, in the order stored. */
export function loadStore(keys: Iterable<string> | undefined, storeDir = CACHE_DIR) {
  const m = new Map<string, Stored[]>();
  const dir = `${storeDir}/entries`;
  if (!existsSync(dir)) return m;
  const all = keys ?? readdirSync(dir).map((f) => f.replace(/\.jsonl$/, ""));
  for (const k of all) {
    if (!existsSync(`${dir}/${k}.jsonl`)) continue;
    const seenSha = new Set<string>();
    const list: Stored[] = [];
    for (const l of readFileSync(`${dir}/${k}.jsonl`, "utf8").split("\n").filter(Boolean)) {
      const s = JSON.parse(l) as Stored;
      if (seenSha.has(s.bodySha)) continue;
      seenSha.add(s.bodySha);
      list.push(s);
    }
    m.set(k, list);
  }
  return m;
}

/** Copies a replayed run's blobs into the store (the run stays self-contained either way). */
export function seedStore(lessonDir: string, storeDir = CACHE_DIR) {
  const src = `${lessonDir}/calls/blobs`;
  if (!existsSync(src)) return 0;
  mkdirSync(`${storeDir}/blobs`, { recursive: true });
  let n = 0;
  for (const f of readdirSync(src))
    if (!existsSync(`${storeDir}/blobs/${f}`)) {
      copyFileSync(`${src}/${f}`, `${storeDir}/blobs/${f}`);
      n += 1;
    }
  return n;
}

/** The run summary line (log.jsonl `cache` event and cache.json). */
export function summary(stats: CacheStats, policy: string, note: string) {
  return {
    ev: "cache",
    policy,
    note,
    callsMade: stats.made,
    callsCached: stats.cached,
    imported: stats.imported,
    refused: stats.refused,
    failed: stats.failed,
    spentUsd: Number(stats.spentUsd.toFixed(6)),
    savedUsd: Number(stats.savedUsd.toFixed(6)),
    byStage: stats.byStage,
  };
}
