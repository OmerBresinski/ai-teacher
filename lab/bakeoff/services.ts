// BAKEOFF harness: the shared services every arm uses unchanged. OpenAI calls (streamed and plain,
// with cost), the picture director + bank (lab/cand's, as production), the diagram spec + drawer.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { Writable } from "node:stream";
import pino from "../../apps/worker/node_modules/pino/pino.js";
import { createPictureBank } from "../../apps/worker/src/picture-bank";
import { createAi, createBudget } from "../../packages/ai/src/index";
import { createDb } from "../../packages/db/src/index";
import { newId } from "../../packages/domain/src/index";
import { z } from "../../packages/generation/node_modules/zod";
import {
  DIAGRAM_CONTRACT,
  DiagramSpecSchema,
} from "../../packages/generation/src/plan-write/diagram-spec";
import {
  judgeMade,
  pickPhoto,
  plainSubject,
} from "../../packages/generation/src/stages/illustrate";
import { mustShowOf } from "../../packages/generation/src/stages/photo-bank";
import {
  findDirected,
  type LessonLook,
} from "../../packages/generation/src/stages/picture-director";
import {
  isHistoricalSet,
  setImagePrompt,
  setSize,
} from "../../packages/generation/src/stages/picture-set";
import * as im from "../../packages/images/src/index";
import { parseDiagram, withLongLabels } from "../../packages/slides/src/diagrams/index";
import { placePhoto } from "../../packages/slides/src/templates/index";
import { createStorage } from "../../packages/storage/src/index";

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
  /** Spent, booked elsewhere and still held. */
  get committed() {
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
    let open = true;
    return () => {
      if (open) this.held = Math.max(0, this.held - est);
      open = false;
    };
  }
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
  const held = ledger.tryHold(what, est);
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

/** Worst-case cost of one paid step (USD), reserved before it starts. */
export const STEP_EST = {
  main: 0.12, // sol, the whole streamed plan at its output cap
  objectives: 0.01,
  notes: 0.003, // luna, one slide
  repair: 0.004, // luna, one slide
  diagram: 0.004, // luna spec, two attempts (observed $0.0013 each)
  picture: 0.025,
  pictureSet: 0.02, // up to 2 strips + a judge per panel + a set judge // director + up to 3 generations + judges (generation also under the bank cap)
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

/** One structured call; returns the parsed output, usage and cost. */
export async function chat(
  r: ChatReq,
): Promise<{ out: unknown; text: string; usage: Usage; usd: number; ms: number }> {
  const t0 = performance.now();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key(".dayback-openai-key")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body(r, false)),
  });
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
  const gen = guardedGenerator(
    im.createOpenAiImageGenerator({ apiKey: okey }),
    () => opts.ledger.parts.pictures ?? 0,
    opts.bankCapUsd,
  );
  const pex = im.createPexelsClient({ apiKey: key(".dayback-pexels-key") });
  const commons = im.createCommonsClient();
  const images = {
    search: (q: string, o: object) =>
      pex.search({ query: q, ...o, locale: "en-GB" }).then((p: { photos: unknown }) => p.photos),
    store: (photo: unknown, target: string) =>
      im.storePhoto({ photo, target, storage, workspaceId: WS } as never),
    searchCommons: (q: string, o: object) => commons.search({ query: q, ...o }),
    bank: createPictureBank({
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
      onEvent: (e: { costUsd?: number }) => {
        opts.ledger.add("pictures", e.costUsd ?? 0);
        appendFileSync(
          `${opts.runDir}/pictures.bank.jsonl`,
          `${JSON.stringify({ t: Date.now(), ...e })}\n`,
        );
      },
    } as never),
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
      if (r.outcome !== "placed" || !r.photo) return undefined;
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
      ask: { subject: request, named: ask.named ? plainSubject(ask.shows).slice(0, 60) : null },
      brief: b as never,
      slide: ask.slide,
      lesson: { title: lesson.title, yearGroup: lesson.yearGroup, subject: lesson.subject },
      country: "England",
      index: ask.index,
      stock: stock as never,
      judgeMade: (brief: unknown, made: { dataUrl?: string }, reuse?: boolean) =>
        made.dataUrl
          ? judgeMade({
              lesson: pickerLesson(lesson, ask.index) as never,
              index: ask.index,
              ...(reuse ? { reuse } : {}),
              brief: brief as never,
              deps: deps as never,
              dataUrl: made.dataUrl,
              onVerdict: (v: { boxes?: Box4[] }) => {
                madeBoxes = v.boxes;
              },
            })
          : Promise.resolve(true),
      deps: deps as never,
      ...(look ? { look } : {}),
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
    return guarded(opts.ledger, `picture set ${setKey}`, STEP_EST.pictureSet, () =>
      findSetOne(asks, lesson, setKey),
    );
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
    let best: { results: (PhotoResult | undefined)[]; ok: number } | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      let made: Awaited<ReturnType<typeof gen.generate>>;
      try {
        made = await gen.generate({ prompt, size: setSize(asks.length) } as never);
      } catch (e) {
        runLog({ ev: "set-error", set: setKey, attempt, err: String(e).slice(0, 200) });
        break;
      }
      opts.ledger.add("pictures", made.costUsd);
      let panels: Uint8Array[];
      try {
        panels = im.splitPanels(made.bytes, asks.length, aspect);
      } catch (e) {
        runLog({ ev: "set-error", set: setKey, attempt, err: String(e).slice(0, 200) });
        break;
      }
      const urls = panels.map((p) => `data:image/png;base64,${Buffer.from(p).toString("base64")}`);
      const boxes: (Box4[] | undefined)[] = [];
      const judged = await Promise.all(
        asks.map((a, k) => {
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
            dataUrl: urls[k] ?? "",
            onVerdict: (v: { boxes?: Box4[] }) => {
              boxes[k] = v.boxes;
            },
          }).catch(() => false);
        }),
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
      });
      const results = setPanelResults(asks, panels, pass, boxes, {
        model: gen.model,
        style:
          look?.style === "illustration"
            ? "illustration"
            : look?.generic === "generate"
              ? "house"
              : "photo",
        save: (bytes) => {
          const id = newId();
          const k2 = `${WS}/sets/${id}.png`;
          mkdirSync(resolve(STORE, k2, ".."), { recursive: true });
          writeFileSync(resolve(STORE, k2), bytes);
          return { id, src: `/files/${k2}`, aspect: aspectOf(`/files/${k2}`) };
        },
        setKey,
      });
      const ok = results.filter(Boolean).length;
      if (!best || ok > best.ok) best = { results, ok };
      if (ok === asks.length) break;
    }
    const out = best?.results ?? asks.map(() => undefined);
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
  ): Promise<{ same: boolean; odd: number[] } | undefined> {
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
      const o = r.out as { same?: boolean; odd?: number[] } | undefined;
      return typeof o?.same === "boolean" ? { same: o.same, odd: o.odd ?? [] } : undefined;
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
};
/** The diagram spec prompt: BAKEOFF/prompts/shared/diagram-spec.txt when the prompt agent has written it, else SOL-SIMPLE's. */
function diagramSystem(): string {
  for (const f of [
    `${BAKEOFF}/prompts/shared/diagram-spec.txt`,
    `${ROUNDS}/SOL-SIMPLE/prompts/diagram-spec.txt`,
  ])
    try {
      return `${readFileSync(f, "utf8").trim()}\n\n${DIAGRAM_CONTRACT}`;
    } catch {}
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
async function specCalls(
  ask: DiagramAsk,
  ledger: Ledger,
  log: (e: object) => void,
  kindSchema: unknown,
): Promise<unknown | undefined> {
  const schema = z.toJSONSchema(kindSchema as never, { target: "draft-7" });
  const user = `${ask.yearGroup}\nKind: ${ask.kind}\nRequest: ${ask.shows}${ask.labels.length ? `\nLabels: ${ask.labels.join("; ")}` : ""}\n\nThe slide:\n${ask.words}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await chat({
      model: "gpt-6-luna",
      effort: "low",
      system: diagramSystem(),
      user,
      schema,
      name: "diagram",
      strict: false,
    });
    ledger.add("diagrams", r.usd);
    log({ ev: "diagram-call", key: ask.key, ms: r.ms, usd: r.usd, attempt });
    // dd-diagrams2: labels a little over their limit parse as the slide will draw them (stretched).
    if (r.out && withLongLabels(() => parseDiagram(r.out))) return r.out;
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
    style: "photo" | "illustration";
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
