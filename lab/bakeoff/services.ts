// BAKEOFF harness: the shared services every arm uses unchanged. OpenAI calls (streamed and plain,
// with cost), the picture director + bank (lab/cand's, as production), the diagram spec + drawer.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { Writable } from "node:stream";
import pino from "../../apps/worker/node_modules/pino/pino.js";
import { createPictureBank } from "../../apps/worker/src/picture-bank";
import { createAi, createBudget } from "../../packages/ai/src/index";
import { createDb } from "../../packages/db/src/index";
import { newId } from "../../packages/domain/src/index";
import type { z } from "../../packages/generation/node_modules/zod";
import { DIAGRAM_CONTRACT } from "../../packages/generation/src/plan-write/diagram-spec";
import {
  judgeMade,
  pickPhoto,
  plainSubject,
} from "../../packages/generation/src/stages/illustrate";
import { mustShowOf } from "../../packages/generation/src/stages/photo-bank";
import {
  createDirectorBatcher,
  findDirected,
  type LessonLook,
} from "../../packages/generation/src/stages/picture-director";
import {
  isHistoricalSet,
  setImagePrompt,
  setSize,
  soloImagePrompt,
} from "../../packages/generation/src/stages/picture-set";
import * as im from "../../packages/images/src/index";
import {
  diagramJsonSchema,
  drawerJsonSchema,
  limitLines,
  meaningFaults,
  mendSpec,
  parseDiagram,
  withLongLabels,
} from "../../packages/slides/src/diagrams/index";
// Round 3 fix: the drawer's own schema, not generation's mirror. The mirror's particles `show`
// had only states/diffusion/dissolving (no compare or collision) and no cubes kind, so the spec
// writer could not ask for y11 s8's "faster particles at a higher temperature".
import { DiagramSpecSchema } from "../../packages/slides/src/diagrams/schema";
import { placePhoto } from "../../packages/slides/src/templates/index";
import { createStorage } from "../../packages/storage/src/index";
import { locale, localise } from "./locale";

export const ROUNDS =
  "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/quality-prd/lab/rounds";
export const BAKEOFF = `${ROUNDS}/BAKEOFF`;
const key = (f: string) => readFileSync(`${homedir()}/${f}`, "utf8").trim();

/* ------------------------------------------------------------------ */
/* Cost                                                                */
/* ------------------------------------------------------------------ */

export const PRICES: Record<string, { in: number; cached: number; out: number }> = {
  "gpt-6.1-sol": { in: 2, cached: 0.1, out: 10 },
  "gpt-6-luna": { in: 0.1, cached: 0.01, out: 0.5 },
};
export type Usage = {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
};
export function usd(model: string, u: Usage): number {
  const p = PRICES[model];
  if (!p) throw new Error(`no price for ${model}`);
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  return (
    ((u.prompt_tokens - cached) * p.in + cached * p.cached + u.completion_tokens * p.out) / 1e6
  );
}

/** Spend per part of a run ("main", "notes", "diagrams", "pictures", "repair"), and a hard cap.
 * The cap is held before money is spent (as arm C, 6 Oct): each paid step reserves its worst case
 * first and does not start when that would pass the cap; parallel steps see each other's holds. */
export class Ledger {
  parts: Record<string, number> = {};
  private held = 0;
  /** Spend booked outside the parts (the picture director's AI log), counted against the cap. */
  outside: () => number = () => 0;
  constructor(public capUsd: number) {}
  add(part: string, v: number) {
    this.parts[part] = (this.parts[part] ?? 0) + v;
  }
  get total() {
    return Object.values(this.parts).reduce((a, b) => a + b, 0);
  }
  /**
   * Other runs sharing one budget (`shareBudget`): their committed spend, counted against this
   * cap too, so two arms run side by side can't each spend the whole cap.
   */
  peers: () => number = () => 0;
  /** Spent, booked elsewhere, still held, and what the runs sharing this budget have committed. */
  get committed() {
    return this.total + this.outside() + this.held + this.peers();
  }
  /** This run's own committed spend (what it publishes to the shared budget). */
  get own() {
    return this.total + this.outside() + this.held;
  }
  /** Refusals (round 2): steps the cap kept from starting, for the run log. */
  refused: string[] = [];
  /**
   * Reserves `est` before a step starts, or refuses it (undefined) when spend plus holds plus `est`
   * would pass the cap. Never throws: a refused picture or diagram falls back, the run goes on.
   */
  tryHold(what: string, est: number): (() => void) | undefined {
    if (this.committed + est > this.capUsd + 1e-9) {
      this.refused.push(what);
      return undefined;
    }
    return this.guard(what, est);
  }
  /** Reserves `est` (the step's worst case) or throws when it would pass the cap; returns the release. */
  guard(what: string, est: number): () => void {
    if (this.committed + est > this.capUsd + 1e-9)
      throw new Error(`cap $${this.capUsd} would be passed by ${what} (held $${est})`);
    this.held += est;
    this.publish();
    let open = true;
    return () => {
      if (open) this.held = Math.max(0, this.held - est);
      open = false;
      this.publish();
    };
  }
  /** Set by `shareBudget`: writes this run's committed spend for the runs it shares with. */
  publish: () => void = () => {};
  /** What the sharing runs have actually spent (holds excluded); set by `shareBudget`. */
  peersSpent: () => number = () => 0;
  /** Spend that no release can free: this run's and its peers', holds excluded. */
  get spent() {
    return this.total + this.outside() + this.peersSpent();
  }
  /**
   * Round 3 fix: `tryHold`, but a step refused only because other steps hold reserves waits for
   * them to release (polling, up to `waitMs`) instead of being refused at once. Six parallel runs
   * each holding a main call's worst case starved y1's hen picture set and refused y10 and y11's
   * main calls although real spend was far under the cap. Refuses at once when spend alone fails.
   */
  async holdWhenFree(what: string, est: number, waitMs = 60_000, pollMs = 250) {
    const end = Date.now() + waitMs;
    for (;;) {
      if (this.spent + est > this.capUsd + 1e-9) break;
      if (this.committed + est <= this.capUsd + 1e-9) return this.guard(what, est);
      if (Date.now() >= end) break;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    this.refused.push(what);
    return undefined;
  }
}

/**
 * One hard cap across several runs at once (an A/B run side by side): each run writes its
 * committed spend to `<dir>/<id>.json` on every hold and release, and counts the others' against
 * the shared cap. Picture run 5 (6 Oct) overshot because each arm had its own cap.
 */
export function shareBudget(ledger: Ledger, dir: string, id: string) {
  mkdirSync(dir, { recursive: true });
  const mine = `${dir}/${id}.json`;
  ledger.publish = () =>
    writeFileSync(
      mine,
      JSON.stringify({ committed: ledger.own, spent: ledger.total + ledger.outside() }),
    );
  ledger.peersSpent = () => {
    let sum = 0;
    for (const f of readdirSync(dir))
      if (f.endsWith(".json") && `${dir}/${f}` !== mine)
        try {
          const j = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
          sum += Number(j.spent ?? j.committed) || 0;
        } catch {}
    return sum;
  };
  ledger.peers = () => {
    let sum = 0;
    for (const f of readdirSync(dir))
      if (f.endsWith(".json") && `${dir}/${f}` !== mine)
        try {
          sum += Number(JSON.parse(readFileSync(`${dir}/${f}`, "utf8")).committed) || 0;
        } catch {}
    return sum;
  };
  ledger.publish();
}

/**
 * Every image generation (or edit) reserves its own worst case on the run's ledger before it
 * starts and is refused (throws, so the ladder treats it as a miss) past the run cap; its real
 * cost is booked as part "pictures" before the hold is released. This is the run-level hard cap
 * for pictures: no separate bank cap can add spend past it.
 */
export function ledgerGenerator<
  G extends {
    model: string;
    generate: (a: never) => Promise<{ costUsd: number }>;
    edit?: (a: never) => Promise<{ costUsd: number }>;
  },
>(g: G, ledger: Ledger, est: (size: string, edit: boolean) => number): G {
  const wrap =
    (call: (a: never) => Promise<{ costUsd: number }>, isEdit: boolean) =>
    async (a: { size: string }) => {
      const held = await ledger.holdWhenFree(
        isEdit ? "image edit" : "image generation",
        est(a.size, isEdit),
      );
      if (!held) throw new Error(`run cap $${ledger.capUsd} reached`);
      try {
        const out = await call(a as never);
        ledger.add("pictures", out.costUsd);
        return out;
      } finally {
        held();
      }
    };
  return {
    ...g,
    generate: wrap(g.generate.bind(g), false),
    ...(g.edit ? { edit: wrap(g.edit.bind(g), true) } : {}),
  } as G;
}

/** A generation's worst case: low-quality output tokens at the size, plus a prompt, plus 25%. */
export function imageEstimate(size: string, edit: boolean): number {
  const base = im.expectedImageCostUsd(size as never);
  return (edit ? base + 1200 * (10 / 1e6) : base) * 1.25;
}

/**
 * Round 2 cap guard: run a paid job only if its reserve fits under the cap, checked before the
 * job starts. Refused, failed or thrown jobs resolve to undefined; the hold is always released.
 */
export async function guarded<T>(
  ledger: Ledger,
  what: string,
  est: number,
  job: () => Promise<T | undefined>,
  log?: (e: object) => void,
): Promise<T | undefined> {
  const held = await ledger.holdWhenFree(what, est);
  if (!held) {
    log?.({ ev: "cap-refused", what, est, committed: Number(ledger.committed.toFixed(4)) });
    return undefined;
  }
  try {
    return await job();
  } catch (e) {
    log?.({ ev: "job-error", what, err: String(e).slice(0, 200) });
    return undefined;
  } finally {
    held();
  }
}

/** The batched picture director is on unless DIRECTOR_BATCH=0 (round 3 default). */
export const DIRECTOR_BATCH_ON = () => process.env.DIRECTOR_BATCH !== "0";

/** Worst-case cost of one paid step (USD), reserved before it starts. */
export const STEP_EST = {
  // Round 5: the reserve at the real cost (r4 main calls $0.029-0.040), not the output cap ($0.12):
  // 12 parallel worst-case holds passed the $0.85 run cap before any spend.
  main: 0.045, // sol, the whole streamed plan
  objectives: 0.01,
  notes: 0.003, // luna, one slide
  repair: 0.004, // luna, one slide
  objectiveRepair: 0.012, // luna, the whole lesson in, up to four slides out
  diagram: 0.004, // luna spec, two attempts (observed $0.0013 each)
  // Generations reserve themselves (ledgerGenerator); these holds cover the director and judges.
  picture: 0.006,
  pictureSet: 0.006, // up to 2 strips + a judge per panel + a set judge // director + up to 3 generations + judges (generation also under the bank cap)
};

/* ------------------------------------------------------------------ */
/* OpenAI                                                              */
/* ------------------------------------------------------------------ */

export type ChatReq = {
  model: string;
  effort?: "minimal" | "low" | "medium" | "high";
  system: string;
  user: string;
  schema: object;
  name?: string;
  strict?: boolean;
  /** Output cap (reasoning included): bounds the cost of a runaway call. */
  maxTokens?: number;
  /** Deadline for one attempt (non-streamed calls), default CHAT_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Caller's abort (the objectives fallback aborts a slow primary stream). */
  signal?: AbortSignal;
  /** Pictures (data URLs) sent after the user text, in order. */
  images?: string[];
};
const body = (r: ChatReq, stream: boolean) => ({
  model: r.model,
  ...(r.effort ? { reasoning_effort: r.effort } : {}),
  messages: [
    { role: "system", content: r.system },
    {
      role: "user",
      content: r.images?.length
        ? [
            { type: "text", text: r.user },
            ...r.images.map((url) => ({ type: "image_url", image_url: { url, detail: "low" } })),
          ]
        : r.user,
    },
  ],
  response_format: {
    type: "json_schema",
    json_schema: { name: r.name ?? "out", strict: r.strict ?? true, schema: r.schema },
  },
  ...(r.maxTokens ? { max_completion_tokens: r.maxTokens } : {}),
  ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
});

/** A non-streamed structured call's deadline (the slowest healthy luna call seen was ~15 s). */
export const CHAT_TIMEOUT_MS = 40_000;

/** One structured call; returns the parsed output, usage and cost. */
/** Round 8: a request's prompt text with the teacher's locale filled in. */
function localiseReq<R extends { system?: unknown; user?: unknown }>(r: R): R {
  return {
    ...r,
    ...(typeof r.system === "string" ? { system: localise(r.system) } : {}),
    ...(typeof r.user === "string" ? { user: localise(r.user) } : {}),
  };
}

export async function chat(
  r: ChatReq,
): Promise<{ out: unknown; text: string; usage: Usage; usd: number; ms: number }> {
  r = localiseReq(r);
  const t0 = performance.now();
  // Round 3 (R2 y10: eleven notes calls hung ~80 s, then the socket closed): every call has a
  // deadline; a timed-out or dropped call is tried once more before it fails.
  const once = () =>
    fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key(".dayback-openai-key")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body(r, false)),
      signal: AbortSignal.timeout(r.timeoutMs ?? CHAT_TIMEOUT_MS),
    });
  const res = await once().catch(() => once());
  const j = (await res.json()) as {
    choices?: { message: { content: string } }[];
    usage: Usage;
    error?: unknown;
  };
  if (!res.ok || !j.choices)
    throw new Error(`openai ${res.status}: ${JSON.stringify(j.error ?? j).slice(0, 300)}`);
  const text = j.choices[0]?.message.content ?? "";
  let out: unknown;
  try {
    out = JSON.parse(text);
  } catch {
    out = undefined;
  }
  return {
    out,
    text,
    usage: j.usage,
    usd: usd(r.model, j.usage),
    ms: Math.round(performance.now() - t0),
  };
}

/** One streamed structured call: `onText` gets each content delta as it arrives. */
export async function chatStream(
  r: ChatReq,
  onText: (delta: string) => void,
): Promise<{ text: string; usage: Usage; usd: number; ms: number; firstTokenMs: number }> {
  r = localiseReq(r);
  const t0 = performance.now();
  // Stalls and runaway whitespace abort the call (a strict-schema stream once went quiet for 10
  // minutes and died with ECONNRESET, its usage never reported).
  const ac = new AbortController();
  let stall: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(stall);
    stall = setTimeout(() => ac.abort(new Error("stream stalled 90 s")), 90_000);
  };
  arm();
  if (r.signal) {
    if (r.signal.aborted) ac.abort(r.signal.reason);
    else r.signal.addEventListener("abort", () => ac.abort(r.signal?.reason), { once: true });
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: ac.signal,
    headers: {
      Authorization: `Bearer ${key(".dayback-openai-key")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body(r, true)),
  });
  if (!res.ok || !res.body)
    throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let pending = "";
  let text = "";
  let usage: Usage | undefined;
  let first = -1;
  let blank = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    arm();
    pending += dec.decode(value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith("data:")) continue;
      const data = l.slice(5).trim();
      if (data === "[DONE]") continue;
      const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; usage?: Usage };
      if (j.usage) usage = j.usage;
      const d = j.choices?.[0]?.delta?.content;
      if (d) {
        blank = /^\s*$/.test(d) ? blank + d.length : 0;
        if (blank > 400) {
          ac.abort(new Error("runaway whitespace"));
          throw new Error(`runaway whitespace after ${text.length} chars`);
        }
        if (first < 0) first = Math.round(performance.now() - t0);
        text += d;
        onText(d);
      }
    }
  }
  clearTimeout(stall);
  if (!usage) throw new Error("stream ended without usage");
  return {
    text,
    usage,
    usd: usd(r.model, usage),
    ms: Math.round(performance.now() - t0),
    firstTokenMs: first,
  };
}

/** A recorded stream played back at its recorded pace (or instantly): no spend, for dry runs. */
export async function replayStream(file: string, onText: (d: string) => void, msPerKChar = 0) {
  const text = readFileSync(file, "utf8");
  for (let i = 0; i < text.length; i += 40) {
    onText(text.slice(i, i + 40));
    if (msPerKChar) await new Promise((r) => setTimeout(r, (msPerKChar * 40) / 1000));
  }
  return {
    text,
    usage: { prompt_tokens: 0, completion_tokens: 0 } as Usage,
    usd: 0,
    ms: 0,
    firstTokenMs: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Pictures: picture director + bank (production code, lab/cand)       */
/* ------------------------------------------------------------------ */

export const STORE = `${BAKEOFF}/base-pg/store`;
const WS = "0e7a1000-0000-4000-8000-000000000e7a";
export type PhotoAsk = {
  key: string;
  shows: string;
  mustSee: string[];
  named: boolean;
  /** The slot's width / height: stock search prefers it, the director and generation frame for it. */
  aspect?: number;
  /** The slot crops to its own box: a generic stock photo that would only fit shrunk is refused (generation renders at the slot's shape). */
  fixedShape?: boolean;
  /** Aborts this picture's job (an early flow job no slide took over). */
  signal?: AbortSignal;
  /** A set member: false when the set's panels are different things compared (still made together). */
  sameSubject?: boolean;
  /** The design call's `design.picture_style`: "illustration" generates generic pictures in the lesson's one style. */
  style?: "photo" | "illustration";
  slide: { heading: string; text: string; point: string };
  index: number;
};
export type PhotoResult = {
  /** The request text the picture director was given. */
  request: string;
  /** The must-see subjects' boxes in the picture (fractions 0..1), when the judge returned them. */
  subjects?: { name: string; x: number; y: number; w: number; h: number }[];
  src: string;
  alt: string;
  aspect: number;
  about?: string;
  provider?: string;
  source?: unknown;
  /** How the picture looks: stock is a photo; generated is photo, illustration or drawn (ruling 163 gate). */
  style?: "photo" | "illustration" | "drawn" | "house";
  /** The period the request belongs to, when the director gave one (ruling 163 gate). */
  period?: string;
  /** The same-subject set this picture was made in (one strip, cut apart). */
  set?: string;
};

/** The picture services for one run; `costs` collects bank and director spend. */
export function pictureService(opts: {
  /** The lesson's picture style and theme palette, read when each generation starts. */
  styleOf?: () => { style?: "photo" | "illustration"; palette?: string[] };
  /** No library lookups (a clean A/B: every picture fetched or made for this run). */
  noLibrary?: boolean;
  /** `generate`: every generic picture is made in the house photo look (no stock, no other looks). */
  generic?: "stock-first" | "generate";
  runDir: string;
  pgPort: number;
  ledger: Ledger;
  bankCapUsd: number;
}) {
  mkdirSync(opts.runDir, { recursive: true });
  const okey = key(".dayback-openai-key");
  const aiLog = `${opts.runDir}/pictures.ai.jsonl`;
  const AI_LOGGER = pino({ level: "info" }, pino.destination({ dest: aiLog, sync: true }));
  const MODEL = "openai/gpt-6-luna";
  const ai = createAi(
    {
      OPENAI_API_KEY: okey,
      AI_MODEL_FRONTIER: MODEL,
      AI_MODEL_STANDARD: MODEL,
      AI_MODEL_SMALL: MODEL,
    },
    { logger: AI_LOGGER },
  );
  const storage = {
    put: async (k: string, b: unknown) => {
      const bytes =
        b instanceof ReadableStream
          ? new Uint8Array(await new Response(b).arrayBuffer())
          : (b as Uint8Array);
      mkdirSync(resolve(STORE, k, ".."), { recursive: true });
      writeFileSync(resolve(STORE, k), bytes);
      return { key: k };
    },
  };
  const gen = ledgerGenerator(
    guardedGenerator(
      im.createOpenAiImageGenerator({ apiKey: okey }),
      () => opts.ledger.parts.pictures ?? 0,
      opts.bankCapUsd,
    ),
    opts.ledger,
    imageEstimate,
  );
  const pex = im.createPexelsClient({ apiKey: key(".dayback-pexels-key") });
  const commons = im.createCommonsClient();
  const images = {
    search: (q: string, o: object) =>
      pex
        .search({ query: q, ...o, locale: locale().spelling })
        .then((p: { photos: unknown }) => p.photos),
    store: (photo: unknown, target: string) =>
      im.storePhoto({ photo, target, storage, workspaceId: WS } as never),
    searchCommons: (q: string, o: object) => commons.search({ query: q, ...o }),
    bank: withoutLibrary(
      createPictureBank({
        db: (() => {
          const d = createDb(
            `postgres://postgres:postgres@localhost:${opts.pgPort}/teaching_journey`,
          ) as { unsafeDb?: unknown; db?: unknown };
          return (d.unsafeDb ?? d.db) as never;
        })(),
        storage: createStorage({ STORAGE_ROOT: STORE }).adapter,
        embedder: im.createOpenAiEmbedder({ apiKey: okey }),
        // The lesson's look travels on each request (LessonLook), not as a string appended here.
        generator: gen,
        capUsd: opts.bankCapUsd,
        ids: () => newId(),
        onEvent: (e: { kind?: string; costUsd?: number }) => {
          // Generations are booked by ledgerGenerator; the bank books only its embeddings here.
          if (e.kind !== "generate") opts.ledger.add("pictures", e.costUsd ?? 0);
          appendFileSync(
            `${opts.runDir}/pictures.bank.jsonl`,
            `${JSON.stringify({ t: Date.now(), ...e })}\n`,
          );
        },
      } as never),
      opts.noLibrary,
    ),
  };
  const logger = pino(
    { level: "info" },
    new Writable({
      write(c, _e, cb) {
        appendFileSync(`${opts.runDir}/pictures.log.jsonl`, c.toString());
        cb();
      },
    }),
  );
  /**
   * With the prompt agent's `prompts/shared/director-batch.txt`, picture slots asked within
   * DIRECTOR_BATCH_WINDOW_MS (default 400) share one director call (round 3 COST.md). On by default
   * (round 3 ship config in code); DIRECTOR_BATCH=0 turns it off for an ablation.
   */
  const batchFile = `${BAKEOFF}/prompts/shared/director-batch.txt`;
  const direct =
    DIRECTOR_BATCH_ON() && existsSync(batchFile)
      ? createDirectorBatcher(
          {
            ai,
            budget: createBudget({ capUsd: 0.05, capTokens: 2_000_000 }),
            effortFor: () => "low",
            signal: new AbortController().signal,
            logger,
            now: () => new Date(),
            ids: () => newId(),
            context: { lessonId: "bakeoff-director-batch", jobId: "bakeoff-director-batch" },
          } as never,
          readFileSync(batchFile, "utf8"),
          Number(process.env.DIRECTOR_BATCH_WINDOW_MS ?? "400"),
        )
      : undefined;
  /** The director's AI spend so far (from its call log). */
  const aiSpend = () => {
    try {
      return readFileSync(aiLog, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { ai?: { costUsd?: number } })
        .reduce((a, r) => a + (r.ai?.costUsd ?? 0), 0);
    } catch {
      return 0;
    }
  };
  async function find(
    ask: PhotoAsk,
    lesson: {
      id: string;
      title: string;
      yearGroup: string;
      subject: string;
      base: Record<string, unknown>;
    },
  ): Promise<PhotoResult | undefined> {
    return guarded(opts.ledger, `picture ${ask.key}`, STEP_EST.picture, () => findOne(ask, lesson));
  }
  async function findOne(
    ask: PhotoAsk,
    lesson: Parameters<typeof find>[1],
  ): Promise<PhotoResult | undefined> {
    // The stock candidates this ask was shown, so a refused pool can be kept for review.
    const pool: { id: string; url: string }[] = [];
    const note = (ps: unknown) => {
      for (const p of (Array.isArray(ps) ? ps : []) as {
        id?: unknown;
        src?: { medium?: string; large?: string };
        url?: string;
      }[]) {
        const url = p.src?.medium ?? p.src?.large ?? p.url;
        if (url) pool.push({ id: String(p.id ?? pool.length), url });
      }
      return ps;
    };
    const poolImages = {
      ...images,
      search: (q: string, o: object) => images.search(q, o).then(note),
      searchCommons: (q: string, o: object) => images.searchCommons(q, o).then(note),
    };
    const deps = {
      ai,
      budget: createBudget({ capUsd: 0.05, capTokens: 2_000_000 }),
      effortFor: () => "low",
      signal: ask.signal ?? new AbortController().signal,
      logger,
      now: () => new Date(),
      ids: () => newId(),
      images: poolImages,
      context: { lessonId: lesson.id, jobId: `bakeoff-${lesson.id}` },
    };
    const request = [ask.shows, ...ask.mustSee].join(". ");
    const b = {
      subject: plainSubject(ask.shows).slice(0, 60),
      request: request.slice(0, 400),
      mustShow: ask.mustSee.length ? ask.mustSee : mustShowOf(request),
      purpose: "context",
      specific: ask.named,
      ...(ask.aspect ? { aspect: Math.round(ask.aspect * 100) / 100 } : {}),
    };
    const at = (x: unknown) =>
      pickPhoto(pickerLesson(lesson, ask.index, x) as never, ask.index, deps as never).catch(
        () => ({ outcome: "empty" }),
      );
    // Illustration lessons: generic pictures are generated in the lesson's style (no stock photos);
    // named real things still come from Commons and Pexels (ruling 163 unchanged).
    // The director's route decides what is a real thing (brief.specific), not the arm's flag: the
    // y10 bake-off asks for Prospero were routed to Commons and then never searched.
    const illustrated = ask.style === "illustration";
    const look = lessonLook(
      { ...opts.styleOf?.(), ...(opts.generic ? { generic: opts.generic } : {}) },
      ask.style,
    );
    let madeBoxes: Box4[] | undefined;
    const stock = async (first: unknown) => {
      if (illustrated && !(first as { specific?: boolean }).specific) return undefined;
      const r = (await at(first)) as { outcome: string; photo?: { src: string; boxes?: Box4[] } };
      if (r.outcome !== "placed" || !r.photo) {
        // The judge refused the whole stock pool: keep its first candidates for review.
        const files: string[] = [];
        for (const [n, c] of pool.slice(0, 4).entries()) {
          try {
            const res = await fetch(c.url);
            if (!res.ok) continue;
            const f = `${opts.runDir}/rejected/${ask.key.replace(/[^\w.+-]/g, "_")}-stock-${n}.jpg`;
            mkdirSync(dirname(f), { recursive: true });
            writeFileSync(f, new Uint8Array(await res.arrayBuffer()));
            files.push(f);
          } catch {}
        }
        appendFileSync(
          `${opts.runDir}/log.jsonl`,
          `${JSON.stringify({ t: Date.now(), ev: "rejected", key: ask.key, request, check: "stock judge", outcome: r.outcome, files, pool: pool.length })}\n`,
        );
        pool.length = 0;
        return undefined;
      }
      // A generic stock photo that this slot could only show shrunk on a panel is refused, so the
      // director generates one at the slot's shape instead (named real things keep their photo).
      if (!ask.named && ask.fixedShape && ask.aspect) {
        const fit = placePhoto(aspectOf(r.photo.src), ask.aspect, subjectsOf(r.photo.boxes));
        if (fit.mode === "contain") {
          appendFileSync(
            `${opts.runDir}/log.jsonl`,
            `${JSON.stringify({ t: Date.now(), ev: "stock-wrong-shape", key: ask.key, src: r.photo.src })}\n`,
          );
          return undefined;
        }
      }
      return r.photo;
    };
    const photo = (await findDirected({
      bank: images.bank as never,
      ask: {
        subject: request,
        named: ask.named ? plainSubject(ask.shows).slice(0, 60) : null,
        // Round 8: the slide's own request is the picture's spec; the director only adds searches.
        writer: {
          shows: ask.shows,
          mustShow: ask.mustSee.length ? ask.mustSee : mustShowOf(request),
          subject: ask.named ? "named" : "generic",
        },
      },
      brief: b as never,
      slide: ask.slide,
      lesson: { title: lesson.title, yearGroup: lesson.yearGroup, subject: lesson.subject },
      country: locale().country,
      index: ask.index,
      stock: stock as never,
      judgeMade: (brief: unknown, made: { dataUrl?: string; src?: string }, reuse?: boolean) => {
        if (!made.dataUrl) return Promise.resolve(true);
        let seen: { why?: string; fits?: boolean } | undefined;
        return judgeMade({
          lesson: pickerLesson(lesson, ask.index) as never,
          index: ask.index,
          brief: brief as never,
          deps: deps as never,
          dataUrl: made.dataUrl,
          ...(reuse ? { reuse } : {}),
          onVerdict: (v: { boxes?: Box4[]; why?: string | null; fits?: boolean }) => {
            madeBoxes = v.boxes;
            seen = { why: v.why ?? undefined, fits: v.fits };
          },
        }).then((ok) => {
          // A refused generated (or library) picture stays in the store; log it for review.
          if (!ok)
            appendFileSync(
              `${opts.runDir}/log.jsonl`,
              `${JSON.stringify({ t: Date.now(), ev: "rejected", key: ask.key, request: request, src: made.src, check: reuse ? "reuse judge" : "picture judge", fits: seen?.fits, why: seen?.why })}\n`,
            );
          return ok;
        });
      },
      deps: deps as never,
      ...(look ? { look } : {}),
      ...(direct ? { direct } : {}),
      onOutcome: (o: object) =>
        appendFileSync(
          `${opts.runDir}/log.jsonl`,
          `${JSON.stringify({ t: Date.now(), ev: "picture-outcome", key: ask.key, ...o })}\n`,
        ),
    }).catch((e: unknown) => {
      appendFileSync(
        `${opts.runDir}/log.jsonl`,
        `${JSON.stringify({ t: Date.now(), ev: "picture-error", key: ask.key, err: String(e).slice(0, 300) })}\n`,
      );
      return undefined;
    })) as
      | {
          src: string;
          alt: string;
          about?: string;
          source?: { provider?: string };
          boxes?: Box4[];
          look?: PhotoResult["style"];
          period?: string;
        }
      | undefined;
    if (!photo) return undefined;
    return {
      request,
      src: photo.src,
      alt: photo.alt,
      about: photo.about,
      provider: photo.source?.provider,
      source: photo.source,
      style: photo.look ?? "photo",
      ...(photo.period ? { period: photo.period } : {}),
      // The judge's boxes for the must-see items (judge v15): the stock pick's own, else the
      // made-picture judge's last verdict for this ask.
      ...(subjectsOf(
        photo.boxes ??
          (photo.source?.provider === "pexels" || photo.source?.provider === "commons"
            ? undefined
            : madeBoxes),
      )
        ? { subjects: subjectsOf(photo.boxes ?? madeBoxes) }
        : {}),
      aspect: aspectOf(photo.src),
    };
  }
  const runLog = (e: object) =>
    appendFileSync(`${opts.runDir}/log.jsonl`, `${JSON.stringify({ t: Date.now(), ...e })}\n`);

  /**
   * A same-subject set (a sequence's panels, or compare cards of one thing at different stages):
   * one generated strip of N panels, cut apart, each panel judged by the same photo judge against
   * its own request, then the set judged for sameness in one call (when the prompt agent's
   * `set-judge` files exist). A failing panel or set regenerates the whole strip once (a lone
   * panel regenerated would not be the same animal). Named real things and history lessons keep
   * the per-picture ladder (Commons first, ruling 163).
   */
  async function findSet(
    asks: PhotoAsk[],
    lesson: Parameters<typeof find>[1],
  ): Promise<(PhotoResult | undefined)[]> {
    // Not generated as a set: named real things, history lessons, and change across real time
    // (a street in 1900 and 2000): each picture takes the director's ladder (ruling 163).
    if (
      asks.some((a) => a.named) ||
      /^hist/i.test(lesson.subject) ||
      isHistoricalSet(asks.map((a) => a.shows))
    )
      return Promise.all(asks.map((a) => find(a, lesson)));
    const setKey = asks.map((a) => a.key).join("+");
    // A refused hold (run cap) is a failed set: every panel undefined, never a missing array.
    const out = await guarded(opts.ledger, `picture set ${setKey}`, STEP_EST.pictureSet, () =>
      findSetOne(asks, lesson, setKey),
    );
    return Array.isArray(out) ? out : asks.map(() => undefined);
  }
  async function findSetOne(
    asks: PhotoAsk[],
    lesson: Parameters<typeof find>[1],
    setKey: string,
  ): Promise<(PhotoResult | undefined)[]> {
    const deps = {
      ai,
      budget: createBudget({ capUsd: 0.05, capTokens: 2_000_000 }),
      effortFor: () => "low",
      signal: new AbortController().signal,
      logger,
      now: () => new Date(),
      ids: () => newId(),
      images,
      context: { lessonId: lesson.id, jobId: `bakeoff-${lesson.id}` },
    };
    const look = lessonLook(
      { ...opts.styleOf?.(), ...(opts.generic ? { generic: opts.generic } : {}) },
      asks[0]?.style,
    );
    const shows = asks.map((a) => a.shows);
    // Compare cards of different things are still one set (one look, one scale), framed as a
    // matched set rather than one individual.
    const prompt = setImagePrompt(
      shows,
      look,
      asks.every((a) => a.sameSubject !== false),
    );
    const aspect = asks[0]?.aspect ?? 4 / 3;
    runLog({ ev: "set-start", set: setKey, n: asks.length, aspect });
    /** One panel judged alone against its own request (the set's panel judge, and solo panels). */
    const judgePanel = (
      a: PhotoAsk,
      url: string,
      k: number,
      boxes: (Box4[] | undefined)[],
      panelWhy: (string | undefined)[],
    ) => {
      const request = [a.shows, ...a.mustSee].join(". ");
      const brief = {
        subject: plainSubject(a.shows).slice(0, 60),
        request: request.slice(0, 400),
        // A set panel must show its subject; the stage details ("developing feathers") are
        // the strip's job and the set judge's, not a per-panel must (y1 chick: the growing
        // chicken failed twice on "developing feathers" while the judge said it fit).
        mustShow: a.mustSee.length ? a.mustSee : mustShowOf(request).slice(0, 1),
        purpose: "context",
        specific: false,
        aspect: Math.round(aspect * 100) / 100,
      };
      return judgeMade({
        lesson: pickerLesson(lesson, a.index) as never,
        index: a.index,
        brief: brief as never,
        deps: deps as never,
        dataUrl: url,
        onVerdict: (v: { boxes?: Box4[]; why?: string | null }) => {
          boxes[k] = v.boxes;
          panelWhy[k] = v.why ?? undefined;
        },
      }).catch(() => false);
    };
    const panelOpts = {
      model: gen.model,
      style: (look?.style === "illustration"
        ? "illustration"
        : look?.generic === "generate"
          ? "house"
          : "photo") as "photo" | "illustration" | "house",
      save: (bytes: Uint8Array) => {
        const id = newId();
        const k2 = `${WS}/sets/${id}.png`;
        mkdirSync(resolve(STORE, k2, ".."), { recursive: true });
        writeFileSync(resolve(STORE, k2), bytes);
        return { id, src: `/files/${k2}`, aspect: aspectOf(`/files/${k2}`) };
      },
    };
    let best: { results: (PhotoResult | undefined)[]; ok: number } | undefined;
    // Round 5 retry cap: one strip; panels it could not place get one solo generation each (one
    // regenerate per slot). A second strip doubled the cost on y1 r4 and failed the same way.
    for (let attempt = 0; attempt < 1; attempt++) {
      let made: Awaited<ReturnType<typeof gen.generate>>;
      try {
        made = await gen.generate({ prompt, size: setSize(asks.length) } as never);
      } catch (e) {
        runLog({ ev: "set-error", set: setKey, attempt, err: String(e).slice(0, 200) });
        break;
      }
      let panels: Uint8Array[];
      try {
        panels = im.splitPanels(made.bytes, asks.length, aspect);
        const dup = im.duplicatePanels(panels);
        if (dup.length)
          throw new Error(`strip repeats a panel: ${dup.map((p) => p.join("=")).join(", ")}`);
      } catch (e) {
        runLog({ ev: "set-error", set: setKey, attempt, err: String(e).slice(0, 200) });
        break;
      }
      const urls = panels.map((p) => `data:image/png;base64,${Buffer.from(p).toString("base64")}`);
      const boxes: (Box4[] | undefined)[] = [];
      const panelWhy: (string | undefined)[] = [];
      const judged = await Promise.all(
        asks.map((a, k) => judgePanel(a, urls[k] ?? "", k, boxes, panelWhy)),
      );
      const same = await judgeSet(shows, urls);

      const odd = new Set(same?.odd ?? []);
      const pass = judged.map((j, k) => j === true && (!same || same.same || !odd.has(k)));
      runLog({
        ev: "set-attempt",
        set: setKey,
        attempt,
        usd: made.costUsd,
        panels: judged,
        same: same ? same.same : "skipped",
        odd: [...odd],
        ...(same?.why ? { why: same.why } : {}),
      });
      // Every rejected panel is kept for review (round2/pics3/ab "Rejected by the checker").
      for (const [k, ok] of pass.entries()) {
        if (ok) continue;
        const f = `${opts.runDir}/rejected/${setKey.replace(/[^\w.+-]/g, "_")}-a${attempt}-p${k}.png`;
        mkdirSync(dirname(f), { recursive: true });
        writeFileSync(f, panels[k] ?? new Uint8Array());
        runLog({
          ev: "rejected",
          key: asks[k]?.key,
          request: asks[k]?.shows,
          file: f,
          check: judged[k] !== true ? "panel judge" : "set judge",
          why: judged[k] !== true ? panelWhy[k] : same?.why,
        });
      }
      const results = setPanelResults(asks, panels, pass, boxes, { ...panelOpts, setKey });
      const ok = results.filter(Boolean).length;
      if (!best || ok > best.ok) best = { results, ok };
      if (ok === asks.length) break;
    }
    // Round 4 partial-set fallback (y1 cat and sheep placed 1 of 2, and all-or-none dropped both):
    // each panel the set could not place is generated alone, same request in the lesson's look,
    // and judged alone; panels the set placed are kept.
    const solo = async (a: PhotoAsk, k: number): Promise<PhotoResult | undefined> => {
      try {
        const made = await gen.generate({
          prompt: soloImagePrompt(a.shows, look),
          size: setSize(1),
        } as never);
        // One picture, not a strip: cropped to the card's shape, never split.
        const panel = im.splitPanels(made.bytes, 1, aspect)[0] ?? made.bytes;
        const url = `data:image/png;base64,${Buffer.from(panel).toString("base64")}`;
        const bx: (Box4[] | undefined)[] = [];
        const why: (string | undefined)[] = [];
        const ok = (await judgePanel(a, url, 0, bx, why)) === true;
        runLog({
          ev: "set-solo",
          set: setKey,
          key: a.key,
          ok,
          usd: made.costUsd,
          ...(ok ? {} : { why: why[0] }),
        });
        if (!ok) return undefined;
        return setPanelResults([a], [panel], [true], bx, {
          ...panelOpts,
          setKey: `${setKey}#solo${k}`,
        })[0];
      } catch (e) {
        runLog({ ev: "set-solo-error", set: setKey, key: a.key, err: String(e).slice(0, 200) });
        return undefined;
      }
    };
    const out = await fillPartialSet(best?.results ?? asks.map(() => undefined), asks, solo);
    runLog({ ev: "set-done", set: setKey, placed: out.filter(Boolean).length, of: asks.length });
    return out;
  }

  /**
   * One call over all of a set's panels: is it the same subject in every panel? Needs the prompt
   * agent's `prompts/shared/set-judge.txt` and `set-judge-schema.json` ({same, odd[]}, odd as
   * 0-based panel indexes); without them the set is not judged for sameness (logged "skipped").
   */
  async function judgeSet(
    shows: string[],
    urls: string[],
  ): Promise<{ same: boolean; odd: number[]; why?: string } | undefined> {
    const dir = `${BAKEOFF}/prompts/shared`;
    if (!existsSync(`${dir}/set-judge.txt`) || !existsSync(`${dir}/set-judge-schema.json`))
      return undefined;
    try {
      const r = await chat({
        model: "gpt-6-luna",
        effort: "low",
        system: readFileSync(`${dir}/set-judge.txt`, "utf8"),
        user: shows.map((s, i) => `Panel ${i + 1}: ${s}`).join("\n"),
        images: urls,
        schema: JSON.parse(readFileSync(`${dir}/set-judge-schema.json`, "utf8")),
        name: "set_judge",
        maxTokens: 2000,
      });
      opts.ledger.add("pictures", r.usd);
      const o = r.out as { same?: boolean; odd?: number[]; why?: string } | undefined;
      return typeof o?.same === "boolean"
        ? { same: o.same, odd: o.odd ?? [], ...(o.why ? { why: o.why } : {}) }
        : undefined;
    } catch {
      return undefined;
    }
  }
  return { find, findSet, aiSpend };
}

type Box4 = { item: string; left: number; top: number; right: number; bottom: number };
/** The judge's boxes as template subjects ({name, x, y, w, h}); undefined when there are none. */
export function subjectsOf(boxes?: Box4[]) {
  const ok = (boxes ?? []).filter((b) => b.right > b.left && b.bottom > b.top);
  return ok.length
    ? ok.map((b) => ({
        name: b.item,
        x: b.left,
        y: b.top,
        w: b.right - b.left,
        h: b.bottom - b.top,
      }))
    : undefined;
}

export type PickerLessonInfo = {
  id: string;
  title: string;
  yearGroup: string;
  subject: string;
  base: Record<string, unknown>;
};
/**
 * The lesson the production picture code (`pickPhoto`, `judgeMade`) reads: every `facts` field it
 * touches (objectives, vocabulary, keyIdeas, outline) present, the brief's topic, and an outline
 * entry for slide `index` carrying `imageBrief`. Smoke 2/3: a missing field threw inside the
 * judge, so every stock pick failed and every generated picture was rejected.
 */
export function pickerLesson(l: PickerLessonInfo, index: number, imageBrief?: unknown) {
  const facts = {
    objectives: [],
    vocabulary: [],
    keyIdeas: [],
    ...((l.base.facts ?? {}) as object),
  };
  return {
    ...l.base,
    id: l.id,
    title: l.title,
    yearGroup: l.yearGroup,
    subject: l.subject,
    brief: { topic: l.title },
    facts: {
      ...facts,
      outline: Array.from({ length: index + 1 }, (_, i) =>
        i === index
          ? {
              id: `s${i + 1}`,
              kind: "image-text",
              factRefs: [],
              ...(imageBrief ? { imageBrief } : {}),
            }
          : { id: `s${i + 1}`, kind: "content", factRefs: [] },
      ),
    },
  };
}

/**
 * The lesson's picture look for the director: the style, the theme's palette, and the prompt
 * agent's style line when its file exists (else the director's default painted line).
 */
export function lessonLook(
  st:
    | { style?: "photo" | "illustration"; palette?: string[]; generic?: "stock-first" | "generate" }
    | undefined,
  style?: "photo" | "illustration",
): LessonLook | undefined {
  const generic = st?.generic;
  const s = style ?? st?.style ?? (generic === "generate" ? "photo" : undefined);
  if (!s) return undefined;
  const file = `${BAKEOFF}/prompts/shared/illustration-style.txt`;
  const line = s === "illustration" && existsSync(file) ? readFileSync(file, "utf8").trim() : "";
  const houseFile = `${BAKEOFF}/prompts/shared/house-photo.txt`;
  const houseLine =
    s === "photo" && generic === "generate" && existsSync(houseFile)
      ? readFileSync(houseFile, "utf8").trim()
      : "";
  return {
    style: s,
    ...(st?.palette?.length ? { palette: st.palette } : {}),
    ...(line ? { line } : {}),
    ...(generic ? { generic } : {}),
    ...(houseLine ? { houseLine } : {}),
  };
}

/**
 * Superseded by `lessonLook` (the look now travels on the bank request). One locked illustration style per lesson (Greg 6 Oct): when the lesson's picture style is
 * "illustration", every generation's prompt gets the prompt agent's style line
 * (prompts/shared/illustration-style.txt, {{palette}} = the theme's colours), the same on every
 * call. No file yet: prompts pass through unchanged and the run logs it. A reference image per
 * lesson (the first generation, sent with the rest) needs the image edits endpoint: not wired yet.
 */
export function styledGenerator<G extends { generate: (a: never) => Promise<unknown> }>(
  g: G,
  styleOf?: () => { style?: "photo" | "illustration"; palette?: string[] },
): G {
  const file = `${BAKEOFF}/prompts/shared/illustration-style.txt`;
  return {
    ...g,
    generate: (a: never) => {
      const st = styleOf?.();
      const arg = a as { prompt?: string };
      if (st?.style !== "illustration" || !arg.prompt || !existsSync(file)) return g.generate(a);
      const line = readFileSync(file, "utf8")
        .trim()
        .replace("{{palette}}", (st.palette ?? []).join(", "));
      return g.generate({ ...arg, prompt: `${arg.prompt}\n\n${line}` } as never);
    },
  };
}

/**
 * The image generator with a hard cap the bank's own cap missed (smoke 3: 20 parallel generations
 * against a $0.03 cap, $0.125 spent). Generations still run in parallel, but each reserves its
 * cost (about $0.0063) first, and none starts once spend plus reservations would pass the cap.
 */
export function guardedGenerator<G extends { generate: (a: never) => Promise<unknown> }>(
  g: G,
  spent: () => number,
  capUsd: number,
): G {
  const PER = 0.0063;
  let reserved = 0;
  return {
    ...g,
    generate: async (a: never) => {
      if (spent() + reserved + PER > capUsd + 1e-9)
        throw new Error(`picture generation cap $${capUsd} reached`);
      reserved += PER;
      try {
        return await g.generate(a);
      } finally {
        reserved -= PER;
      }
    },
  };
}

/** A stored photo's own width / height (sips, macOS); 4:3 when it cannot be read. */
export function aspectOf(src: string): number {
  const f = `${STORE}/${decodeURIComponent(src.replace(/^\/files\//, ""))}`;
  const o = Bun.spawnSync(["sips", "-g", "pixelWidth", "-g", "pixelHeight", f]).stdout.toString();
  const w = Number(o.match(/pixelWidth: (\d+)/)?.[1]);
  const h = Number(o.match(/pixelHeight: (\d+)/)?.[1]);
  return w && h ? w / h : 4 / 3;
}

/* ------------------------------------------------------------------ */
/* Diagrams: spec call (gpt-6-luna) + the repo's drawer                */
/* ------------------------------------------------------------------ */

export type DiagramAsk = {
  key: string;
  kind: string;
  shows: string;
  labels: string[];
  words: string;
  yearGroup: string;
  /** Round 8 (DIAGRAM-SOURCE C2.5): the slide's ask line for this figure, what pupils do with it. */
  task?: string;
  /** Round 8 (dataflow audit D): where the drawing goes, like a picture call's zone. */
  slot?: { placement: "beside text" | "across the slide"; w: number; h: number };
};
/** The diagram spec prompt: BAKEOFF/prompts/shared/diagram-spec.txt when the prompt agent has written it, else SOL-SIMPLE's. */
function diagramSystem(): string {
  // Round 8 (C2.4-5): the prompt owner's v2 drawer text and contract when present; the limits
  // block is generated from the one limits table (limits.ts), never typed.
  const read = (f: string) => {
    try {
      return readFileSync(f, "utf8").trim();
    } catch {
      return undefined;
    }
  };
  const contract = read(`${BAKEOFF}/prompts/shared/diagram-contract.v2.txt`) ?? DIAGRAM_CONTRACT;
  for (const f of [
    `${BAKEOFF}/prompts/shared/diagram-spec.v2.txt`,
    `${BAKEOFF}/prompts/shared/diagram-spec.txt`,
    `${ROUNDS}/SOL-SIMPLE/prompts/diagram-spec.txt`,
  ]) {
    const head = read(f);
    if (head) return `${head}\n\n${contract}\n\n${limitLines()}`;
  }
  throw new Error("no diagram spec prompt");
}
export async function diagramSpec(
  ask: DiagramAsk,
  ledger: Ledger,
  log: (e: object) => void,
): Promise<unknown | undefined> {
  const kindSchema = (DiagramSpecSchema.options as { shape: { kind: { value: string } } }[]).find(
    (o) => o.shape.kind.value === ask.kind,
  );
  if (!kindSchema) return undefined;
  return guarded(
    ledger,
    `diagram ${ask.key}`,
    STEP_EST.diagram,
    () => specCalls(ask, ledger, log, kindSchema),
    log,
  );
}
/**
 * Round 4 fix: a JSON schema OpenAI's response_format accepts. The drawer's zod schema has tuples
 * (particles `key`), which draft-7 writes as `items: [a, b]`; OpenAI refuses that (400 "is not of
 * type 'object'"), so every particles spec failed in round 4 (y7 5/5, y11 stretch 5/5). A tuple
 * becomes an array of its first item's type with the tuple's length.
 */
export function openaiSchema<T>(node: T): T {
  if (Array.isArray(node)) return node.map(openaiSchema) as T;
  if (!node || typeof node !== "object") return node;
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) o[k] = openaiSchema(v);
  if (Array.isArray(o.items)) {
    const list = o.items as unknown[];
    o.items = list[0] ?? {};
    o.minItems ??= list.length;
    o.maxItems ??= list.length;
    delete o.additionalItems;
  }
  if (Array.isArray(o.prefixItems)) {
    const list = o.prefixItems as unknown[];
    delete o.prefixItems;
    o.items ??= list[0] ?? {};
    o.minItems ??= list.length;
    o.maxItems ??= list.length;
  }
  return o as T;
}

/**
 * A set that placed only some panels: each missing panel is made alone by `solo` (in parallel);
 * placed panels are kept as they are. Never throws (a failed solo stays undefined).
 */
export async function fillPartialSet<A, R>(
  results: (R | undefined)[],
  asks: A[],
  solo: (a: A, k: number) => Promise<R | undefined>,
): Promise<(R | undefined)[]> {
  return Promise.all(
    asks.map((a, k) => (results[k] !== undefined ? results[k] : solo(a, k).catch(() => undefined))),
  );
}

/** Why a spec doesn't draw, in a line ("" when it does): the schema's issues as path: message. */
export function diagramFaultOf(out: unknown, parses: (o: unknown) => unknown): string {
  if (parses(out)) return "";
  const kind = (out as { kind?: unknown })?.kind;
  const own = (DiagramSpecSchema.options as unknown as z.ZodType[]).find(
    (o) => (o as unknown as { shape?: { kind?: { value?: unknown } } }).shape?.kind?.value === kind,
  );
  const r = (own ?? DiagramSpecSchema).safeParse(out);
  if (r.success) return "it did not draw";
  return r.error.issues
    .slice(0, 4)
    .map((i) => `${i.path.map(String).join(".") || "spec"}: ${i.message}`)
    .join("; ");
}
async function specCalls(
  ask: DiagramAsk,
  ledger: Ledger,
  log: (e: object) => void,
  kindSchema: unknown,
): Promise<unknown | undefined> {
  // r5: the one wire schema, derived from the drawer's (`diagramJsonSchema`); `kindSchema` only
  // says the kind exists.
  void kindSchema;
  const schema = drawerJsonSchema(ask.kind as Parameters<typeof drawerJsonSchema>[0]);
  const slot = ask.slot
    ? `\nSlot: ${ask.slot.placement}, ${Math.round(ask.slot.w)} by ${Math.round(ask.slot.h)} points`
    : "";
  const user = `${ask.yearGroup}\nKind: ${ask.kind}${slot}\nRequest: ${ask.shows}${ask.labels.length ? `\nLabels: ${ask.labels.join("; ")}` : ""}${ask.task ? `\nTask: ${ask.task}` : ""}\n\nThe slide:\n${ask.words}`;
  let fault = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await chat({
      model: "gpt-6-luna",
      effort: "low",
      system: diagramSystem(),
      // Round 3 fix (y11 s8 particles failed twice, reason never seen): the retry is told why.
      user: fault
        ? `${user}\n\nYour last spec did not draw: ${fault}\nFix that and send it again.`
        : user,
      schema,
      name: "diagram",
      strict: false,
    });
    ledger.add("diagrams", r.usd);
    // Round 6: a spec's optional decoration that cannot stand is mended in code (mendSpec).
    if (r.out) r.out = mendSpec(r.out);
    // dd-diagrams2: labels a little over their limit parse as the slide will draw them (stretched).
    // Round 8: a meaning-form spec's faults are said in its own fields (meaning.ts).
    fault = r.out
      ? meaningFaults(r.out) || diagramFaultOf(r.out, (o) => withLongLabels(() => parseDiagram(o)))
      : "no output";
    log({
      ev: "diagram-call",
      key: ask.key,
      ms: r.ms,
      usd: r.usd,
      attempt,
      ...(fault ? { fault, out: r.out } : {}),
    });
    if (!fault) return r.out;
  }
  return undefined;
}

export function writeJson(f: string, v: unknown) {
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, `${JSON.stringify(v, null, 1)}\n`);
}

/**
 * A set's panels as picture results, panel k for ask k only: its own request, alt and key-order
 * position; a panel that failed its judge (or the set) is undefined, never stored or placed.
 */
export function setPanelResults(
  asks: PhotoAsk[],
  panels: Uint8Array[],
  pass: boolean[],
  boxes: (Box4[] | undefined)[],
  o: {
    model: string;
    style: "photo" | "illustration" | "house";
    setKey: string;
    save: (bytes: Uint8Array) => { id: string; src: string; aspect: number };
  },
): (PhotoResult | undefined)[] {
  return asks.map((a, k) => {
    const bytes = panels[k];
    if (!pass[k] || !bytes) return undefined;
    const saved = o.save(bytes);
    const subjects = subjectsOf(boxes[k]);
    return {
      request: [a.shows, ...a.mustSee].join(". "),
      src: saved.src,
      alt: a.shows,
      provider: "generated",
      source: {
        provider: "generated",
        id: saved.id,
        pageUrl: "https://openai.com/policies/",
        photographer: `AI-generated (${o.model})`,
        photographerUrl: "https://openai.com/policies/",
        licence: `generated (${im.IMAGE_TERMS})`,
      },
      style: o.style,
      aspect: saved.aspect,
      set: o.setKey,
      ...(subjects ? { subjects } : {}),
    } as PhotoResult;
  });
}

/** The bank with lookups switched off (`noLibrary`): every request misses the library. */
function withoutLibrary<B extends { lookup: (...a: never[]) => Promise<unknown> }>(
  b: B,
  off?: boolean,
): B {
  return off ? { ...b, lookup: async () => undefined } : b;
}
