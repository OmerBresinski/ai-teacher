/*
 * Single-slide bench (spike/slide-bench): the plan-write generator one slide at a time.
 *
 *   bun eval/slide-bench.ts layout --out <dir> [--cap 0.06] [--runs 1] [--only id,id]
 *   bun eval/slide-bench.ts write  --out <dir> [--cap 0.06] [--runs 3] [--only id,id]
 *   bun eval/slide-bench.ts report --out <dir>          (tables from saved runs, no calls)
 *   bun eval/slide-bench.ts blind  --out <dir>          (the written slides, no metrics, for judging)
 *   bun eval/slide-bench.ts recheck --out <dir>         (re-measure saved slides, no calls)
 *
 * (a) layout: the real planner prompt (plan-lesson) with the subject's real menu, asked for ONE row
 *     (slideCount 2); the teacher's answers carry the objective and the content point. Records the
 *     row's form, layout, parts and aim (the plan has no reason field: the aim stands for it).
 * (b) write: the real writer prompt (write-slides) for one slide of a saved or synthetic plan, with
 *     the real per-slide schema. Measures: schema valid on the first answer (no retry), contract
 *     heuristics (kind of text per slot), first-time fit on all 10 themes with no shrink and no
 *     re-write (`fitWritten`), and the picture brief. Saves each slide's text export.
 * Every call is priced (gpt-6-luna list price) into --spend and refused past --cap.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type PaletteFormId, slotContract } from "@tj/slides";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createOpenAI } from "../../ai/node_modules/@ai-sdk/openai";
import { providerOptionsFor } from "../src/call";
import { fitWritten, type Written } from "../src/plan-write/fit";
import { contractFor, isSetForm, planMenu, slideWriterSchema } from "../src/plan-write/menu";
import {
  type PlanLessonOutput,
  type PlanLessonWire,
  parsePlan,
  planLessonPrompt,
  planLessonSchema,
} from "../src/prompts/plan-lesson";
import type { Audience } from "../src/prompts/shared";
import { writeSlidesPrompt } from "../src/prompts/write-slides";
import { type BenchCase, CASES } from "./slide-bench-cases";

const args = process.argv.slice(2);
const mode = args[0] ?? "report";
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const OUT = flag("--out") ?? "runs/slide-bench";
const ROUNDS = flag("--rounds") ?? "../../../quality-prd/lab/plan-write/rounds";
const CAP = Number(flag("--cap") ?? "0.06");
const RUNS = Number(flag("--runs") ?? (mode === "write" ? "3" : "1"));
const ONLY = flag("--only")?.split(",");
const SPEND = flag("--spend") ?? join(OUT, "spend.json");
const MODEL = "gpt-6-luna";
const PRICE = { in: 0.1e-6, cached: 0.01e-6, out: 0.5e-6 };
const CONCURRENCY = 6;

const readSpend = (): number => {
  try {
    return JSON.parse(readFileSync(SPEND, "utf8")).total_usd as number;
  } catch {
    return 0;
  }
};
let spent = readSpend();
const addSpend = (usd: number) => {
  spent += usd;
  writeFileSync(SPEND, JSON.stringify({ cap_usd: CAP, total_usd: spent }, null, 1));
};

type Ctx = {
  topic: string;
  audience: Audience;
  plan: PlanLessonOutput;
  slide: number;
};

/** A case's plan context: the saved lesson's table, or the synthetic rows parsed as the planner's. */
function contextOf(c: BenchCase): Ctx {
  if (c.from) {
    const l = JSON.parse(readFileSync(join(ROUNDS, c.from.file), "utf8"));
    return {
      topic: l.brief.topic,
      audience: {
        subject: l.subject ?? undefined,
        yearGroup: l.yearGroup ?? undefined,
        ageBand: l.ageBand ?? undefined,
        readingLevel: l.readingLevel ?? undefined,
        language: l.language ?? "en-GB",
      },
      plan: l.facts.slidePlan.plan as PlanLessonOutput,
      slide: c.from.slide,
    };
  }
  const p = c.plan as NonNullable<BenchCase["plan"]>;
  const { plan } = parsePlan({
    misconception: p.misconception,
    objectives: p.objectives,
    runningExample: p.runningExample,
    slides: p.rows,
  });
  return {
    topic: p.topic,
    audience: { subject: p.subject, yearGroup: p.yearGroup, ageBand: p.ageBand, language: "en-GB" },
    plan,
    slide: plan.slides.length,
  };
}

async function call<T>(
  system: string,
  user: string,
  schema: z.ZodType<T>,
  maxOutputTokens: number,
) {
  const t0 = performance.now();
  const r = await generateText({
    model: openai(MODEL),
    system,
    prompt: user,
    output: Output.object({ schema }),
    ...providerOptionsFor(`openai/${MODEL}`, "low"),
    maxOutputTokens,
  });
  const u = r.usage as {
    inputTokens?: number;
    outputTokens?: number;
    inputTokenDetails?: { cacheReadTokens?: number };
  };
  const cached = u.inputTokenDetails?.cacheReadTokens ?? 0;
  const usd =
    ((u.inputTokens ?? 0) - cached) * PRICE.in +
    cached * PRICE.cached +
    (u.outputTokens ?? 0) * PRICE.out;
  addSpend(usd);
  let output: T | undefined;
  let issues: string[] = [];
  try {
    output = (await r.output) as T;
  } catch {
    // Schema miss: keep the raw JSON when it parses, with the validation issues.
    try {
      const raw = JSON.parse(r.text);
      const p = schema.safeParse(raw);
      issues = p.success ? [] : p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      output = raw as T;
    } catch {
      issues = ["not JSON"];
    }
  }
  return { output, issues, usd, ms: Math.round(performance.now() - t0), text: r.text };
}

let openai: ReturnType<typeof createOpenAI>;

/* ---------- contract heuristics (the kind of text in each slot) ---------- */

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const sentences = (s: string) =>
  s
    .replace(/\b(e\.g|i\.e|etc|Dr|Mr|Mrs|St|approx|vs)\./gi, "$1")
    .replace(/\d\.\d/g, "0")
    .split(/[.!?](?:\s+|$)/)
    .filter((x) => x.trim() !== "").length;
const endsStop = (s: string) => /\.\s*$/.test(s) && !/\.\.\.\s*$/.test(s);

/** Why a text is not the kind its slot asks for, or undefined. Word limits are bench heuristics. */
function kindFault(kind: string, s: string): string | undefined {
  const w = words(s);
  switch (kind) {
    case "heading":
      return endsStop(s) || w > 9
        ? `heading ${w} words${endsStop(s) ? ", full stop" : ""}`
        : undefined;
    case "sentence":
      return sentences(s) > 1 ? `${sentences(s)} sentences` : undefined;
    case "clause":
      return sentences(s) > 1 || /;| because | which | although /.test(s)
        ? "more than one clause"
        : undefined;
    case "question":
      // An imperative task ("Solve 2x = 12.") is a question here; two sentences are not.
      return sentences(s) > 1 ? "not one question" : undefined;
    case "instruction":
      return sentences(s) > 1 || w > 16 ? `instruction ${w} words` : undefined;
    case "phrase":
      return endsStop(s) || w > 12
        ? `phrase ${w} words${endsStop(s) ? ", full stop" : ""}`
        : undefined;
    case "label":
      return endsStop(s) || w > 5 ? `label ${w} words` : undefined;
    case "term":
      return w > 4 ? `term ${w} words` : undefined;
    case "answer":
      return w > 3 ? `answer ${w} words` : undefined;
    case "working": {
      // One calculation: at most two "=" (a step and its result); prose of at most 8 words.
      const eq = (s.match(/=/g) ?? []).length;
      const prose = s.split(/\s+/).filter((x) => /^[A-Za-z]{3,}$/.test(x)).length;
      return eq > 2 || prose > 8 ? `working line: ${eq} "=", ${prose} words` : undefined;
    }
    case "labelled-sentence":
      return !s.includes(":") || sentences(s.split(":").slice(1).join(":")) > 1
        ? "not label: sentence"
        : undefined;
    case "gapped-sentence":
      return !s.includes("___") ? "no ___ gap" : undefined;
    case "starter":
      return !/(…|\.\.\.)\s*$/.test(s) ? "starter not ending in …" : undefined;
    default:
      return undefined;
  }
}

function contractFaults(form: string, layout: string, out: Written): string[] {
  const faults: string[] = [];
  const check = (field: string, kind: unknown, v: unknown) => {
    if (typeof kind !== "string" || typeof v !== "string") return;
    const f = kindFault(kind, v);
    if (f) faults.push(`${field}: ${f} — "${v.slice(0, 90)}"`);
  };
  if (isSetForm(form)) {
    for (const [i, q] of (
      (out.questions ?? []) as { question: string; answer: string }[]
    ).entries()) {
      check(`questions[${i}].question`, "question", q.question);
      if (words(q.answer) > 8 || endsStop(q.answer))
        faults.push(`questions[${i}].answer: not a phrase — "${q.answer}"`);
    }
    return faults;
  }
  const contract = slotContract(form as PaletteFormId, layout);
  for (const slot of contract.slots) {
    if (slot.place === "notes") continue;
    const raw = out[slot.field];
    // A compare's two sides come as { left, right }.
    const v =
      raw && typeof raw === "object" && !Array.isArray(raw) && "left" in raw
        ? [(raw as { left: unknown }).left, (raw as { right: unknown }).right]
        : raw;
    const items = Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
    if (slot.max !== undefined && (items.length < slot.min || items.length > slot.max)) {
      faults.push(`${slot.field}: ${items.length} items, contract ${slot.min}-${slot.max}`);
    }
    items.forEach((item, i) => {
      const at = `${slot.field}[${i}]`;
      if (typeof slot.each === "string") {
        check(at, slot.each, item);
        return;
      }
      if (!item || typeof item !== "object") return;
      for (const [k, kind] of Object.entries(slot.each)) {
        const x = (item as Record<string, unknown>)[k];
        if (typeof kind === "string") check(`${at}.${k}`, kind, x);
        else if (kind && typeof kind === "object" && Array.isArray(x)) {
          for (const [j, y] of x.entries()) check(`${at}.${k}[${j}]`, kind.each, y);
        }
      }
    });
  }
  if (form === "hinge") {
    const opts = (out.options ?? []) as { text: string; correct: boolean }[];
    const right = opts.filter((o) => o.correct).length;
    if (right !== 1) faults.push(`options: ${right} marked correct`);
    const lens = opts.map((o) => words(o.text));
    const correct = opts.find((o) => o.correct);
    if (lens.length && Math.max(...lens) > 2 * Math.max(1, Math.min(...lens)))
      faults.push(`options: lengths ${lens.join("/")} words, not alike`);
    if (
      correct &&
      words(correct.text) === Math.max(...lens) &&
      lens.filter((l) => l === words(correct.text)).length === 1 &&
      words(correct.text) >=
        (1.5 * (lens.reduce((a, b) => a + b, 0) - words(correct.text))) /
          Math.max(1, lens.length - 1)
    )
      faults.push("options: the correct one is clearly the longest (give-away)");
  }
  return faults;
}

/** The picture brief a written slide asks for, if any. */
function pictureOf(out: Written): string | undefined {
  const ib = out.imageBrief as unknown;
  const one = Array.isArray(ib) ? ib[0] : ib;
  if (one && typeof one === "object") {
    const b = one as { subject?: string; mustShow?: string[] };
    return `photo: ${b.subject}${b.mustShow?.length ? ` | must show: ${b.mustShow.join(", ")}` : ""}`;
  }
  if (typeof out.figure === "string") return `figure: ${out.figure}`;
  if (typeof out.diagram === "string") return `diagram: ${out.diagram}`;
  return undefined;
}

/** The slide as text: every field, notes last. */
function exportText(out: Written): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(out)) {
    if (k === "notes") continue;
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const x of v) lines.push(`  - ${typeof x === "string" ? x : JSON.stringify(x)}`);
    } else lines.push(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  }
  lines.push(`notes: ${String(out.notes ?? "")}`);
  return lines.join("\n");
}

/* ---------- runner ---------- */

async function pool<T>(jobs: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < jobs.length) {
        const i = next++;
        out[i] = await (jobs[i] as () => Promise<T>)();
      }
    }),
  );
  return out;
}

const cases = CASES.filter((c) => !ONLY || ONLY.includes(c.id));

async function modeWrite() {
  mkdirSync(join(OUT, "write"), { recursive: true });
  const jobs = cases.flatMap((c) =>
    Array.from({ length: RUNS }, (_, r) => async () => {
      if (spent + 0.0012 > CAP) {
        console.error(`REFUSED ${c.id} r${r + 1}: spend ${spent.toFixed(4)} near cap ${CAP}`);
        return;
      }
      const ctx = contextOf(c);
      const row = ctx.plan.slides[ctx.slide - 1];
      if (!row) throw new Error(`${c.id}: no slide ${ctx.slide}`);
      const target = {
        number: ctx.slide,
        form: row.form,
        layout: row.layout,
        contract: contractFor(row.form, row.layout),
      };
      const { system, user } = writeSlidesPrompt({
        topic: ctx.topic,
        audience: ctx.audience,
        objectives: ctx.plan.objectives,
        runningExample: ctx.plan.runningExample,
        misconception: ctx.plan.misconception,
        table: ctx.plan.slides,
        slides: [target],
      });
      const key = `slide${ctx.slide}`;
      const schema = z.object({ [key]: slideWriterSchema(row.form, row.layout) });
      const res = await call(system, user, schema, 4000);
      const out = ((res.output as Record<string, Written> | undefined)?.[key] ?? {}) as Written;
      let fit:
        | ReturnType<typeof fitWritten>
        | { ok: false; field: string; failure: string; themes: string[] };
      try {
        fit = fitWritten(row.form, row.layout, out);
      } catch (e) {
        fit = {
          ok: false,
          field: "-",
          failure: `render error: ${(e as Error).message}`,
          themes: [],
        };
      }
      const rec = {
        case: c.id,
        run: r + 1,
        form: row.form,
        layout: row.layout,
        ks: c.ks,
        hard: c.hard,
        aim: row.purpose,
        schemaValid: res.issues.length === 0 && res.output !== undefined,
        schemaIssues: res.issues,
        contractFaults: contractFaults(row.form, row.layout, out),
        fitsFirstTime: fit.ok,
        fit: fit.ok
          ? undefined
          : { field: fit.field, failure: fit.failure, themes: fit.themes.length },
        picture: pictureOf(out),
        usd: res.usd,
        ms: res.ms,
        out,
      };
      writeFileSync(join(OUT, "write", `${c.id}-r${r + 1}.json`), JSON.stringify(rec, null, 1));
      writeFileSync(join(OUT, "write", `${c.id}-r${r + 1}.txt`), exportText(out));
      console.log(
        `${c.id} r${r + 1} ${row.form}/${row.layout}: schema ${rec.schemaValid ? "ok" : "BAD"} contract ${rec.contractFaults.length} fit ${fit.ok ? "ok" : `FAIL ${rec.fit?.themes}/10 ${rec.fit?.field}`} $${res.usd.toFixed(5)} ${res.ms} ms`,
      );
    }),
  );
  await pool(jobs, CONCURRENCY);
}

async function modeLayout() {
  mkdirSync(join(OUT, "layout"), { recursive: true });
  const jobs = cases.flatMap((c) =>
    Array.from({ length: RUNS }, (_, r) => async () => {
      if (spent + 0.0015 > CAP) {
        console.error(`REFUSED ${c.id} r${r + 1}: spend ${spent.toFixed(4)} near cap ${CAP}`);
        return;
      }
      const ctx = contextOf(c);
      const { system, user } = planLessonPrompt({
        topic: ctx.topic,
        audience: ctx.audience,
        answers: {
          objective: `The lesson's objective: ${c.probe.objective}`,
          point: `The one slide covers: ${c.probe.point}`,
        },
        slideCount: 2,
        menu: planMenu(ctx.audience.subject),
      });
      const res = await call(system, user, planLessonSchema, 4000);
      const wire = res.output as PlanLessonWire | undefined;
      const row = wire ? parsePlan(wire).plan.slides[1] : undefined;
      const rec = {
        case: c.id,
        run: r + 1,
        expected: `${c.form}/${c.layout}`,
        chosen: row ? `${row.form}/${row.layout}` : "-",
        role: row?.role,
        parts: row?.parts,
        aim: row?.purpose,
        rows: wire?.slides,
        schemaValid: res.issues.length === 0,
        usd: res.usd,
        ms: res.ms,
      };
      writeFileSync(join(OUT, "layout", `${c.id}-r${r + 1}.json`), JSON.stringify(rec, null, 1));
      console.log(
        `${c.id}: expected ${rec.expected} chose ${rec.chosen} (${rec.role}, ${rec.parts}) "${rec.aim}" $${res.usd.toFixed(5)}`,
      );
    }),
  );
  await pool(jobs, CONCURRENCY);
}

type WriteRec = {
  case: string;
  run: number;
  form: string;
  layout: string;
  ks: string;
  hard?: string;
  schemaValid: boolean;
  contractFaults: string[];
  fitsFirstTime: boolean;
  fit?: { field: string; failure: string; themes: number };
  picture?: string;
  usd: number;
};

const load = <T>(dir: string): T[] => {
  try {
    return readdirSync(join(OUT, dir))
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(OUT, dir, f), "utf8")) as T);
  } catch {
    return [];
  }
};

function modeReport() {
  const recs = load<WriteRec>("write");
  const byForm = new Map<string, WriteRec[]>();
  for (const r of recs) {
    const k = `${r.form}/${r.layout}`;
    byForm.set(k, [...(byForm.get(k) ?? []), r]);
  }
  console.log(
    "| form/layout | runs | schema ok | contract clean | fits first time | failing slot (themes) |",
  );
  console.log("|---|---|---|---|---|---|");
  for (const [k, rs] of [...byForm.entries()].sort()) {
    const fails = rs
      .filter((r) => !r.fitsFirstTime)
      .map((r) => `${r.fit?.field} (${r.fit?.themes})`);
    console.log(
      `| ${k} | ${rs.length} | ${rs.filter((r) => r.schemaValid).length} | ${rs.filter((r) => r.contractFaults.length === 0).length} | ${rs.filter((r) => r.fitsFirstTime).length} | ${fails.join("; ") || "-"} |`,
    );
  }
  console.log("\nPer case:");
  const byCase = new Map<string, WriteRec[]>();
  for (const r of recs) byCase.set(r.case, [...(byCase.get(r.case) ?? []), r]);
  for (const [k, rs] of [...byCase.entries()].sort()) {
    const r0 = rs[0] as WriteRec;
    console.log(
      `| ${k} | ${r0.form}/${r0.layout} | ${r0.ks} | fit ${rs.filter((r) => r.fitsFirstTime).length}/${rs.length} | contract clean ${rs.filter((r) => r.contractFaults.length === 0).length}/${rs.length} | ${rs
        .filter((r) => !r.fitsFirstTime)
        .map((r) => `r${r.run}: ${r.fit?.failure}`)
        .join(
          " / ",
        )} | ${rs.flatMap((r) => r.contractFaults.map((f) => `r${r.run} ${f}`)).join(" / ")} |`,
    );
  }
  const lay = load<{
    case: string;
    expected: string;
    chosen: string;
    role?: string;
    parts?: number;
    aim?: string;
  }>("layout");
  if (lay.length) {
    console.log(
      "\n| case | expected | chosen | role | parts | aim (the reason) |\n|---|---|---|---|---|---|",
    );
    for (const l of lay.sort((a, b) => a.case.localeCompare(b.case)))
      console.log(
        `| ${l.case} | ${l.expected} | ${l.chosen} | ${l.role} | ${l.parts} | ${l.aim} |`,
      );
  }
  const usd = recs.reduce((a, r) => a + r.usd, 0);
  console.log(
    `\nwrite calls ${recs.length} $${usd.toFixed(4)}; spend file ${readSpend().toFixed(4)}`,
  );
}

function modeBlind() {
  const dir = join(OUT, "write");
  for (const c of cases) {
    const ctx = contextOf(c);
    const row = ctx.plan.slides[ctx.slide - 1];
    console.log(
      `\n##### ${c.id} | ${ctx.audience.subject} ${ctx.audience.yearGroup} | ${row?.role} ${row?.form} | aim: ${row?.purpose}`,
    );
    console.log(
      `objectives: ${row?.objectives.map((o) => ctx.plan.objectives[o - 1]).join(" / ")}`,
    );
    for (let r = 1; r <= 3; r++) {
      try {
        console.log(`--- r${r}\n${readFileSync(join(dir, `${c.id}-r${r}.txt`), "utf8")}`);
      } catch {}
    }
  }
}

/** Re-measure saved slides (contract heuristics and fit) without a call. */
function modeRecheck() {
  const dir = join(OUT, "write");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const rec = JSON.parse(readFileSync(join(dir, f), "utf8"));
    rec.contractFaults = contractFaults(rec.form, rec.layout, rec.out);
    const fit = fitWritten(rec.form, rec.layout, rec.out);
    rec.fitsFirstTime = fit.ok;
    rec.fit = fit.ok
      ? undefined
      : { field: fit.field, failure: fit.failure, themes: fit.themes.length };
    writeFileSync(join(dir, f), JSON.stringify(rec, null, 1));
  }
}

if (mode === "recheck") modeRecheck();
else if (mode === "write" || mode === "layout") {
  openai = createOpenAI({
    apiKey: readFileSync(`${homedir()}/.dayback-openai-key`, "utf8").trim(),
  });
  mkdirSync(OUT, { recursive: true });
  if (mode === "write") await modeWrite();
  else await modeLayout();
  console.log(`spend ${readSpend().toFixed(4)} of cap ${CAP}`);
} else if (mode === "blind") modeBlind();
else modeReport();
