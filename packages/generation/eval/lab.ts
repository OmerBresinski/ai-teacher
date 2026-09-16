#!/usr/bin/env bun
// bun packages/generation/eval/lab.ts --brief <id|path> --label <name> [--cap 2] [--no-judge]
//   [--no-images] [--plan-frontier-from-year N]
//
// The quality lab: ONE brief through the real pipeline on Bedrock, with a snapshot of the documents
// at every persist (so each stage's output can be read on its own), the rubric judge, the
// deterministic checks, and a set of lab checks that name the defects the Chalkie audit found
// (referent without an element, answer printed beside its stem, question before its explanation,
// dropped factRefs, circular definitions, missing concretes). Everything is written under the
// gitignored `eval/results/lab/<label>/` — full content, for a person to read locally. Never run
// in CI; never log content (the pino stream below keeps warnings only).

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Writable } from "node:stream";
import { type Budget, type CreatedAi, createAi, createBudget } from "@tj/ai";
import {
  blockText,
  type CreateLesson,
  CreateLessonSchema,
  checkLesson,
  type Finding,
  type Lesson,
  type LessonFacts,
  lessonFromBrief,
  richDocToPlainText,
  type Slide,
  type SlideElement,
  type Worksheet,
} from "@tj/domain/documents";
import { createPexelsClient } from "@tj/images";
import { type LanguageModelMiddleware, wrapLanguageModel } from "ai";
import pino from "pino";
import { z } from "zod";
import { noSources, type PhotoPlacer, type PipelineDeps, runLessonPipeline } from "../src";
import { PROMPT_VERSIONS } from "../src/prompts";
import { objectiveVerbOf, priorConfidenceOf } from "../src/shapes";
import { type EvalBrief, evalBriefs } from "./briefs";
import { evalPhotoPlacer } from "./photo-placer";
import { scoreLesson } from "./scorers";

const EnvSchema = z.object({
  AWS_BEARER_TOKEN_BEDROCK: z.string().optional(),
  AWS_REGION: z.string().optional(),
  AI_MODEL_FRONTIER: z.string().optional(),
  AI_MODEL_STANDARD: z.string().optional(),
  AI_MODEL_SMALL: z.string().optional(),
  AI_MODEL_JUDGE: z.string().optional(),
  PEXELS_API_KEY: z.string().optional(),
  AI_LESSON_TOKEN_CAP: z.coerce.number().int().positive().default(300_000),
});

/**
 * The lab's placer: Pexels search as the eval's, but `store` keeps the Pexels CDN URL as the
 * element's `src` (no bytes fetched, nothing written) so the local print route can render the
 * deck for a screenshot. Lab only; production always proxies through `/files/`.
 */
async function dataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  const type = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
  const bytes = Buffer.from(await res.arrayBuffer());
  return `data:${type};base64,${bytes.toString("base64")}`;
}

function labPhotoPlacer(apiKey: string): PhotoPlacer {
  const client = createPexelsClient({ apiKey });
  return {
    search: (query, opts) =>
      client.search({ query, ...opts, locale: "en-GB" }).then((page) => page.photos),
    store: async (photo) => ({
      key: `lab/${photo.id}`,
      // A data URL, not the CDN URL: the print route rendered the CDN picture as its alt text
      // (headless Chromium, cross-origin), and a data URL is an accepted `src` by contract.
      url: await dataUrl(photo.src.large),
      width: photo.width,
      height: photo.height,
      bytes: 0,
      contentType: "image/jpeg",
      source: {
        provider: "pexels",
        id: photo.id,
        pageUrl: photo.pageUrl,
        photographer: photo.photographer,
        photographerUrl: photo.photographerUrl,
      },
    }),
  };
}

/**
 * Lab-only recorder: every call's user turn and the model's text answer, by stage, appended as
 * JSON lines under the run directory — so a stage that returns "none" (the photo judge) can be read
 * with what it was shown. Content on local disk only; never in the pipeline's logs (ADR 0015).
 */
function recordingAi(real: CreatedAi, file: string): CreatedAi {
  if (real.kind === "unconfigured") return real;
  const middleware = (
    context: { stage?: string; promptVersion?: string } | undefined,
  ): LanguageModelMiddleware => ({
    wrapGenerate: async ({ doGenerate, params }) => {
      const result = await doGenerate();
      const text = result.content
        .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
        .join("");
      const prompt = params.prompt
        .map(
          (m) =>
            `${m.role}: ${typeof m.content === "string" ? m.content : m.content.map((c) => ("text" in c ? c.text : `[${c.type}]`)).join("")}`,
        )
        .join("\n\n");
      await appendFile(
        file,
        `${JSON.stringify({ stage: context?.stage, promptVersion: context?.promptVersion, prompt, text })}\n`,
      );
      return result;
    },
  });
  return {
    ...real,
    model: (cls, context) =>
      wrapLanguageModel({
        model: real.model(cls, context) as Parameters<typeof wrapLanguageModel>[0]["model"],
        middleware: middleware(context),
      }),
  };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function loadBrief(ref: string): Promise<EvalBrief> {
  const known = evalBriefs().find((b) => b.id === ref);
  if (known) return known;
  const path = resolve(ref);
  const raw = (await Bun.file(path).json()) as unknown;
  const input: CreateLesson = CreateLessonSchema.parse(raw);
  const id =
    path
      .split("/")
      .pop()
      ?.replace(/\.json$/, "") ?? "brief";
  return { id, input };
}

interface Snapshot {
  n: number;
  stage: string;
  atMs: number;
  slides: number;
  blocks: number;
  totals: ReturnType<Budget["totals"]>;
  findings: Finding[];
}

/* ----------------------------------------------------------------------------------------- */
/* Lab checks: the audit's defect classes as code, over the final documents.                  */
/* ----------------------------------------------------------------------------------------- */

interface LabFinding {
  check: string;
  slide?: number;
  detail: string;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function elementTexts(slide: Slide): {
  id: string;
  type: string;
  text: string;
  factRefs: string[];
  y: number;
  h: number;
  x: number;
  w: number;
}[] {
  const out: {
    id: string;
    type: string;
    text: string;
    factRefs: string[];
    y: number;
    h: number;
    x: number;
    w: number;
  }[] = [];
  for (const el of slide.elements) {
    const text =
      "doc" in el && el.doc
        ? richDocToPlainText(el.doc).trim()
        : el.type === "table"
          ? el.rows.map((r: string[]) => r.join(" | ")).join("\n")
          : "";
    out.push({
      id: el.id,
      type: el.type,
      text,
      factRefs: el.generatedFrom?.factRefs ?? [],
      x: el.x,
      y: el.y,
      w: el.w,
      h: el.h,
    });
  }
  return out;
}

const REFERENT =
  /\b(this|that) (road|fort|coin|object)\b|\b(this|the|that) (picture|photo(?:graph)?|image|diagram|map|chart|table|graph|drawing|painting)\b|\b(shown (?:here|below|above)|in the picture|in the photograph|look at the (?:picture|photo|image|diagram|map))\b/i;

function labChecks(lesson: Lesson, worksheet?: Worksheet): LabFinding[] {
  const out: LabFinding[] = [];
  const facts = lesson.facts;
  const slides = lesson.slides;

  // (a) A stem that points at something the slide does not carry.
  slides.forEach((slide, i) => {
    const hasVisual = slide.elements.some((e) => e.type === "image" || e.type === "table");
    const hasImage = slide.elements.some((e) => e.type === "image");
    for (const el of elementTexts(slide)) {
      if (!el.text) continue;
      const m = el.text.match(REFERENT);
      if (m && !hasImage && !hasVisual) {
        out.push({
          check: "referent-without-element",
          slide: i + 1,
          detail: `"${m[0]}" in ${el.type} ${el.id}: "${el.text.slice(0, 90)}"`,
        });
      }
    }
  });

  // (b) The same stem on two slides, or a slide stem repeated on the sheet.
  const stems = new Map<string, string[]>();
  slides.forEach((slide, i) => {
    for (const el of elementTexts(slide)) {
      if (el.text.includes("?") && el.text.length > 15) {
        const key = norm(el.text);
        stems.set(key, [...(stems.get(key) ?? []), `slide ${i + 1}`]);
      }
    }
  });
  for (const block of worksheet?.blocks ?? []) {
    const text = blockText(block);
    for (const line of text.split("\n")) {
      if (line.includes("?") && line.length > 15) {
        const key = norm(line);
        if (stems.has(key)) stems.set(key, [...(stems.get(key) ?? []), "worksheet"]);
      }
    }
  }
  for (const [stem, places] of stems) {
    if (places.length > 1)
      out.push({ check: "duplicate-stem", detail: `${places.join(", ")}: "${stem.slice(0, 90)}"` });
  }

  if (!facts) return out;
  const qById = new Map(facts.questions.map((q) => [q.id, q]));
  const kById = new Map((facts.keyIdeas ?? []).map((k) => [k.id, k]));

  // (c) The answer to a question printed on the slide that asks it.
  slides.forEach((slide, i) => {
    const text = norm(
      elementTexts(slide)
        .map((e) => e.text)
        .join("\n"),
    );
    const refs = new Set(elementTexts(slide).flatMap((e) => e.factRefs));
    for (const ref of refs) {
      const q = qById.get(ref);
      if (!q) continue;
      const stemIn = text.includes(norm(q.stem).slice(0, 40));
      const ans = norm(q.answer);
      if (stemIn && ans.length >= 12 && text.includes(ans.slice(0, Math.min(60, ans.length)))) {
        out.push({
          check: "answer-printed-with-stem",
          slide: i + 1,
          detail: `${q.id}: answer "${q.answer.slice(0, 60)}" appears as slide text`,
        });
      }
    }
  });

  // (d) Outline entry factRefs that no element on the slide carries (Generate dropped them).
  const byId = new Map(slides.map((s, i) => [s.id, i]));
  facts.outline.forEach((entry, oi) => {
    const si = byId.get(entry.id) ?? (slides.length === facts.outline.length ? oi : undefined);
    if (si === undefined) return;
    const slide = slides[si];
    if (!slide) return;
    const carried = new Set(elementTexts(slide).flatMap((e) => e.factRefs));
    if (carried.size === 0) return; // title/objectives or not generated
    const dropped = entry.factRefs.filter((r) => !carried.has(r));
    if (dropped.length > 0)
      out.push({
        check: "dropped-factRefs",
        slide: si + 1,
        detail: `${entry.id} (${entry.kind}) planned ${entry.factRefs.join(",")}; slide carries ${[...carried].join(",")}; dropped ${dropped.join(",")}`,
      });
  });

  // (e) A question asked before the key idea it tests has been explained.
  const explainIndexOfKeyIdea = new Map<string, number>();
  facts.outline.forEach((entry, oi) => {
    if (
      entry.phase === "explain" ||
      entry.kind === "content" ||
      entry.kind === "image-text" ||
      entry.kind === "vocabulary" ||
      entry.kind === "worked-example"
    ) {
      for (const r of entry.factRefs)
        if (kById.has(r) && !explainIndexOfKeyIdea.has(r)) explainIndexOfKeyIdea.set(r, oi);
    }
  });
  facts.outline.forEach((entry, oi) => {
    if (entry.kind === "starter" || entry.phase === "starter") return; // a starter asks before teaching by design
    for (const r of entry.factRefs) {
      const q = qById.get(r);
      if (!q) continue;
      const objs = new Set(q.objectiveRefs ?? []);
      const ideas = (facts.keyIdeas ?? []).filter((k) => k.objectiveRefs.some((o) => objs.has(o)));
      if (ideas.length === 0) continue;
      const earliest = Math.min(
        ...ideas.map((k) => explainIndexOfKeyIdea.get(k.id) ?? Number.POSITIVE_INFINITY),
      );
      if (earliest > oi)
        out.push({
          check: "question-before-explain",
          slide: oi + 1,
          detail: `${entry.id} asks ${q.id} (${q.objectiveRefs?.join(",")}) before any explain slide covers ${ideas.map((k) => k.id).join(",")} (first at outline ${earliest === Number.POSITIVE_INFINITY ? "never" : earliest + 1})`,
        });
    }
  });

  // (e2) Vocabulary planned but not shown: terms in the facts that no vocabulary slide element prints.
  const vocabSlides = slides.filter((s) => s.kind === "vocabulary");
  if (vocabSlides.length > 0) {
    const shown = norm(vocabSlides.flatMap((s) => elementTexts(s).map((e) => e.text)).join("\n"));
    const missing = facts.vocabulary.filter((v) => !shown.includes(norm(v.term)));
    if (missing.length > 0)
      out.push({
        check: "vocabulary-not-shown",
        detail: `${facts.vocabulary.length} terms planned, ${facts.vocabulary.length - missing.length} shown; missing ${missing.map((v) => v.term).join(", ")}`,
      });
  }

  // (f) A definition that uses its own term.
  for (const v of facts.vocabulary) {
    const stem = v.term.toLowerCase().replace(/(s|es|ed|ing)$/, "");
    if (stem.length >= 4 && v.definition.toLowerCase().includes(stem))
      out.push({ check: "circular-definition", detail: `${v.id} "${v.term}": "${v.definition}"` });
  }

  // (g) A key idea with no concrete: no number, date, place, person or named thing.
  for (const k of facts.keyIdeas ?? []) {
    const text = `${k.statement} ${k.explanation} ${k.example}`;
    const numbers = text.match(/\b\d[\d,.]*\b/g) ?? [];
    const proper = (text.match(/(?<![.!?]\s|^)\b[A-Z][a-z]{2,}\b/g) ?? []).filter(
      (w) => !["The", "This", "They", "When", "Roman", "Romans"].includes(w),
    );
    if (numbers.length === 0 && proper.length === 0)
      out.push({ check: "no-concrete", detail: `${k.id}: "${k.statement}"` });
  }

  // (h) Objective coverage: taught (explain) and checked (a question a pupil answers) both needed.
  for (const o of facts.objectives) {
    const taught: string[] = [];
    const checked: string[] = [];
    facts.outline.forEach((entry, oi) => {
      const teaches = entry.factRefs.some((r) => kById.get(r)?.objectiveRefs.includes(o.id));
      const checks =
        entry.factRefs.some((r) => qById.get(r)?.objectiveRefs?.includes(o.id)) &&
        !["content", "vocabulary", "title", "objectives"].includes(entry.kind);
      if (teaches) taught.push(`${oi + 1}`);
      if (checks) checked.push(`${oi + 1}`);
    });
    if (taught.length === 0 || checked.length === 0)
      out.push({
        check: "objective-not-taught-and-checked",
        detail: `${o.id} "${o.text}": taught on [${taught.join(",")}], checked on [${checked.join(",")}]`,
      });
  }

  // (i) Worksheet-tagged questions when no worksheet was requested still reserve pool.
  const uses = { slide: 0, worksheet: 0, exit: 0, any: 0, untagged: 0 };
  for (const q of facts.questions) uses[q.use ?? "untagged"] += 1;
  const onSlides = new Set(
    slides.flatMap((s) => elementTexts(s).flatMap((e) => e.factRefs)).filter((r) => qById.has(r)),
  );
  out.push({
    check: "question-pool",
    detail: `${facts.questions.length} questions (slide ${uses.slide}, worksheet ${uses.worksheet}, exit ${uses.exit}, any ${uses.any}, untagged ${uses.untagged}); ${onSlides.size} reached a slide: ${[...onSlides].join(",")}`,
  });

  return out;
}

/* ----------------------------------------------------------------------------------------- */
/* Rendering the documents for a reader.                                                      */
/* ----------------------------------------------------------------------------------------- */

function factsMarkdown(facts: LessonFacts): string {
  const L: string[] = ["# Facts", ""];
  L.push("## Objectives");
  for (const o of facts.objectives) L.push(`- ${o.id}: ${o.text}`);
  L.push("", "## Key ideas");
  for (const k of facts.keyIdeas ?? []) {
    L.push(`- **${k.id}** (${k.objectiveRefs.join(",")}) ${k.statement}`);
    L.push(`  - explanation: ${k.explanation}`);
    L.push(`  - example: ${k.example}`);
    if (k.analogy) L.push(`  - analogy: ${k.analogy}`);
  }
  L.push("", "## Vocabulary");
  for (const v of facts.vocabulary)
    L.push(
      `- ${v.id} **${v.term}**: ${v.definition}${v.objectiveRefs ? ` (${v.objectiveRefs.join(",")})` : ""}`,
    );
  L.push("", "## Worked examples");
  for (const x of facts.workedExamples) {
    L.push(
      `- ${x.id}: ${x.problem}${x.misconceptionRef ? ` [heads off ${x.misconceptionRef}]` : ""}`,
    );
    x.steps.forEach((s, i) => {
      L.push(`  ${i + 1}. ${s}`);
    });
    L.push(`  - answer: ${x.answer}`);
  }
  L.push("", "## Questions");
  for (const q of facts.questions) {
    L.push(
      `- ${q.id} [${q.use ?? "-"}/${q.tier ?? "-"}] (${q.objectiveRefs?.join(",") ?? "-"}) ${q.stem}`,
    );
    L.push(`  - answer: ${q.answer}`);
    if (q.distractors?.length)
      L.push(
        `  - distractors: ${q.distractors.map((d) => `${d.text}${d.misconceptionRef ? ` [${d.misconceptionRef}]` : ""}`).join(" | ")}`,
      );
    if (q.reasoning) L.push(`  - reasoning: ${q.reasoning}`);
  }
  L.push("", "## Misconceptions");
  for (const m of facts.misconceptions)
    L.push(`- ${m.id} (${m.objectiveRefs.join(",")}) belief: ${m.belief} → ${m.correction}`);
  if (facts.pitch)
    L.push(
      "",
      `## Pitch`,
      `reading age ${facts.pitch.readingAgeTarget}, sentence max ${facts.pitch.sentenceLengthMax}, avoid: ${facts.pitch.avoid.join(", ")}`,
    );
  L.push(
    "",
    `## Outline (${facts.outline.reduce((s, e) => s + e.minutes, 0)} of ${facts.durationMin} min)`,
  );
  facts.outline.forEach((e, i) => {
    L.push(
      `${i + 1}. ${e.id} **${e.kind}** [${e.phase ?? "-"}] ${e.minutes} min; refs ${e.factRefs.join(",")}`,
    );
    if (e.brief)
      L.push(`   - adds: ${e.brief.adds}${e.brief.avoids ? ` / avoids: ${e.brief.avoids}` : ""}`);
    if (e.imageBrief)
      L.push(
        `   - image: ${e.imageBrief.subject} [${e.imageBrief.purpose}] must show ${e.imageBrief.mustShow.join("; ")}${e.imageBrief.avoid?.length ? `; avoid ${e.imageBrief.avoid.join("; ")}` : ""}`,
      );
  });
  return L.join("\n");
}

function slidesMarkdown(lesson: Lesson, worksheet?: Worksheet): string {
  const L: string[] = [`# Slides (${lesson.slides.length}) — ${lesson.title}`, ""];
  lesson.slides.forEach((slide, i) => {
    L.push(`## ${i + 1}. ${slide.kind} (${slide.id})`);
    for (const el of elementTexts(slide)) {
      const geo = `@${Math.round(el.x)},${Math.round(el.y)} ${Math.round(el.w)}x${Math.round(el.h)}`;
      if (el.type === "image") {
        const img = slide.elements.find(
          (e): e is SlideElement & { type: "image" } => e.id === el.id && e.type === "image",
        );
        if (!img) continue;
        L.push(
          `- image ${el.id} ${geo}: alt="${img.alt ?? ""}" src=${String(img.src).slice(0, 80)}${img.source?.evidence ? ` visible=[${img.source.evidence.visible.join("; ")}] count=${img.source.evidence.count}` : ""}`,
        );
      } else if (el.text) {
        L.push(
          `- ${el.type} ${el.id} ${geo}${el.factRefs.length ? ` [${el.factRefs.join(",")}]` : ""}: ${el.text.replace(/\n/g, " ⏎ ")}`,
        );
      } else {
        L.push(`- ${el.type} ${el.id} ${geo}`);
      }
    }
    if (slide.question) L.push(`- question: ${JSON.stringify(slide.question)}`);
    if (slide.notes) L.push(`- notes: ${slide.notes.replace(/\n/g, " ⏎ ")}`);
    L.push("");
  });
  if (worksheet) {
    L.push(`# Worksheet (${worksheet.blocks.length} blocks) — ${worksheet.title}`, "");
    worksheet.blocks.forEach((b, i) => {
      L.push(`${i + 1}. [${b.type}] ${blockText(b).replace(/\n/g, " ⏎ ")}`);
    });
  }
  return L.join("\n");
}

const fmtFinding = (f: Finding) =>
  `- ${f.severity} \`${f.check}\` ${f.target.slideId ? `slide ${f.target.slideId} ` : ""}${f.target.elementId ? `el ${f.target.elementId} ` : ""}${f.target.blockId ? `block ${f.target.blockId} ` : ""}${f.target.factId ? `fact ${f.target.factId} ` : ""}— ${f.message}${f.evidence ? ` (${f.evidence})` : ""}`;

/* ----------------------------------------------------------------------------------------- */

if (import.meta.main) {
  const env = EnvSchema.parse(process.env);
  const briefRef = arg("brief");
  const label = arg("label");
  if (!briefRef || !label) {
    console.error(
      "usage: lab.ts --brief <id|path> --label <name> [--cap usd] [--no-judge] [--no-images] [--plan-frontier-from-year N]",
    );
    process.exit(2);
  }
  const capUsd = Number(arg("cap") ?? 2);
  const created = createAi(env);
  if (created.kind === "unconfigured") {
    console.error("lab: AWS_BEARER_TOKEN_BEDROCK is unset");
    process.exit(2);
  }
  const label0 = arg("label") ?? "run";
  const recordFile = join(import.meta.dir, "results", "lab", label0, "calls.jsonl");
  await mkdir(join(import.meta.dir, "results", "lab", label0), { recursive: true });
  const ai = flag("record") ? recordingAi(created, recordFile) : created;
  const judge: CreatedAi | undefined = flag("no-judge")
    ? undefined
    : createAi({ ...env, AI_MODEL_FRONTIER: env.AI_MODEL_JUDGE ?? ai.modelId("frontier") });
  if (judge && judge.kind === "unconfigured") throw new Error("judge unconfigured");
  const images: PhotoPlacer | undefined =
    flag("no-images") || !env.PEXELS_API_KEY
      ? undefined
      : flag("proxy-src")
        ? evalPhotoPlacer(env.PEXELS_API_KEY)
        : labPhotoPlacer(env.PEXELS_API_KEY);
  const planFrontierFromYear = arg("plan-frontier-from-year")
    ? Number(arg("plan-frontier-from-year"))
    : undefined;

  const brief = await loadBrief(briefRef);
  const dir = join(import.meta.dir, "results", "lab", label);
  await mkdir(join(dir, "snapshots"), { recursive: true });

  const budget = createBudget({ capUsd, capTokens: 2 * env.AI_LESSON_TOKEN_CAP });
  const startedAt = Date.now();
  const now = () => new Date();
  let counter = 0;
  const ids = () => `lab${(++counter).toString(36)}`;
  let lesson = lessonFromBrief(brief.input, `lab-${brief.id}`, now());
  let worksheet: Worksheet | undefined;
  const snapshots: Snapshot[] = [];
  let verifyMs: number | null = null;
  const logLines: string[] = [];

  const signal = new AbortController().signal;
  const context = { lessonId: lesson.id, jobId: `lab-job-${brief.id}-${label}` };
  const deps: PipelineDeps = {
    ai,
    budget,
    signal,
    logger: pino(
      { level: "info" },
      new Writable({
        write(chunk, _enc, cb) {
          const line = chunk.toString();
          try {
            const rec = JSON.parse(line) as { level: number; msg?: string; durationMs?: number };
            if (rec.msg === "facts verified" && typeof rec.durationMs === "number")
              verifyMs = rec.durationMs;
            if (rec.level >= 40) process.stderr.write(line);
            logLines.push(line);
          } catch {
            /* ignore */
          }
          cb();
        },
      }),
    ),
    now,
    ids,
    sources: noSources,
    persist: async (l, w) => {
      lesson = l;
      worksheet = w;
      const n = snapshots.length + 1;
      const stage = l.generation?.stage ?? "none";
      const snap: Snapshot = {
        n,
        stage,
        atMs: Date.now() - startedAt,
        slides: l.slides.length,
        blocks: w?.blocks.length ?? 0,
        totals: budget.totals(),
        findings: l.generation?.findings ?? [],
      };
      snapshots.push(snap);
      await writeFile(
        join(dir, "snapshots", `${String(n).padStart(2, "0")}-${stage}-${l.slides.length}s.json`),
        JSON.stringify({ lesson: l, worksheet: w }, null, 2),
      );
      return { updatedAt: now().toISOString() };
    },
    onProgress: async (percent, message) => {
      process.stderr.write(
        `[${Math.round((Date.now() - startedAt) / 1000)}s] ${percent}% ${message}\n`,
      );
    },
    context,
    ...(images ? { images } : {}),
    ...(planFrontierFromYear !== undefined ? { planFrontierFromYear } : {}),
  };

  let ok = true;
  let error: string | undefined;
  try {
    const final = await runLessonPipeline({ lesson, worksheetId: `lab-${brief.id}-ws` }, deps);
    lesson = final.lesson;
    worksheet = final.worksheet;
  } catch (e) {
    ok = false;
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    process.stderr.write(`pipeline failed: ${error}\n`);
  }
  const durationMs = Date.now() - startedAt;
  const lessonTotals = budget.totals();

  const scored =
    ok && lesson.facts
      ? await scoreLesson(
          brief.id,
          { lesson, worksheet },
          judge ? { ai: judge, budget, signal, context } : undefined,
        )
      : null;
  const allTotals = budget.totals();

  const schemaFindings = checkLesson(lesson, worksheet);
  const lab = labChecks(lesson, worksheet);

  await writeFile(join(dir, "lesson.json"), JSON.stringify(lesson, null, 2));
  if (worksheet) await writeFile(join(dir, "worksheet.json"), JSON.stringify(worksheet, null, 2));
  if (lesson.facts) await writeFile(join(dir, "facts.md"), factsMarkdown(lesson.facts));
  await writeFile(join(dir, "slides.md"), slidesMarkdown(lesson, worksheet));
  await writeFile(join(dir, "log.jsonl"), logLines.join(""));

  const R: string[] = [];
  R.push(`# Lab run ${label} — ${brief.id}`, "");
  R.push(
    `- ok: ${ok}${error ? ` (${error})` : ""}; ${lesson.slides.length} slides, ${worksheet?.blocks.length ?? 0} blocks; duration ${(durationMs / 1000).toFixed(1)} s; verify ${verifyMs ?? "-"} ms`,
  );
  R.push(
    `- models: frontier ${ai.modelId("frontier")}, standard ${ai.modelId("standard")}, small ${ai.modelId("small")}; judge ${judge?.modelId("frontier") ?? "-"}; planFrontierFromYear ${planFrontierFromYear ?? "-"}`,
  );
  R.push(
    `- prompt versions in code: ${Object.entries(PROMPT_VERSIONS)
      .map(([, v]) => v)
      .join(", ")}`,
  );
  R.push(`- prompt versions on lesson: ${JSON.stringify(lesson.generation?.promptVersions ?? {})}`);
  R.push(
    `- verb ${objectiveVerbOf(lesson.brief?.answers)}, confidence ${priorConfidenceOf(lesson.brief?.answers)}, ${lesson.yearGroup} ${lesson.subject}, ${lesson.brief?.durationMin} min`,
  );
  R.push(
    `- lesson cost $${lessonTotals.costUsd?.toFixed(4) ?? "-"} (${lessonTotals.calls} calls, ${lessonTotals.inputTokens}/${lessonTotals.outputTokens} tokens); with judge $${allTotals.costUsd?.toFixed(4) ?? "-"}`,
  );
  R.push(
    "",
    "## Stage snapshots",
    "",
    "| n | stage | at s | slides | blocks | calls | in/out tokens | cost | findings |",
    "|---|---|---:|---:|---:|---:|---:|---:|---|",
  );
  let prev: Snapshot | undefined;
  for (const s of snapshots) {
    const dCalls = s.totals.calls - (prev?.totals.calls ?? 0);
    const dIn = s.totals.inputTokens - (prev?.totals.inputTokens ?? 0);
    const dOut = s.totals.outputTokens - (prev?.totals.outputTokens ?? 0);
    const dCost = (s.totals.costUsd ?? 0) - (prev?.totals.costUsd ?? 0);
    const counts: Record<string, number> = {};
    for (const f of s.findings)
      counts[`${f.check}:${f.severity}`] = (counts[`${f.check}:${f.severity}`] ?? 0) + 1;
    R.push(
      `| ${s.n} | ${s.stage} | ${(s.atMs / 1000).toFixed(1)} | ${s.slides} | ${s.blocks} | +${dCalls} | +${dIn}/${dOut} | +$${dCost.toFixed(4)} | ${
        Object.entries(counts)
          .map(([k, v]) => `${k}×${v}`)
          .join(", ") || "-"
      } |`,
    );
    prev = s;
  }
  R.push("", "## Rubric");
  if (scored?.scores.rubric) {
    R.push(
      "",
      `mean ${scored.scores.rubric.mean?.toFixed(2)}`,
      "",
      "| dimension | score | rationale |",
      "|---|---:|---|",
    );
    for (const [d, score] of Object.entries(scored.scores.rubric.dimensions))
      R.push(
        `| ${d} | ${score ?? "null"} | ${scored.rubricRationales?.[d as keyof typeof scored.rubricRationales] ?? ""} |`,
      );
  } else R.push("(not scored)");
  R.push(
    "",
    `schema score ${scored?.scores.schema ?? "-"}, modelFindings score ${scored?.scores.modelFindings ?? "-"}`,
  );
  R.push("", "## Lab checks", "");
  for (const f of lab) R.push(`- \`${f.check}\`${f.slide ? ` slide ${f.slide}` : ""}: ${f.detail}`);
  R.push("", "## generation.findings (final)", "");
  for (const f of lesson.generation?.findings ?? []) R.push(fmtFinding(f));
  const evaluated = snapshots.find((s) => s.stage === "evaluated");
  if (evaluated) {
    R.push("", "## generation.findings at `evaluated` (before Repair)", "");
    for (const f of evaluated.findings) R.push(fmtFinding(f));
  }
  R.push("", "## checkLesson on the final documents", "");
  for (const f of schemaFindings) R.push(fmtFinding(f));
  await writeFile(join(dir, "REPORT.md"), `${R.join("\n")}\n`);
  await writeFile(
    join(dir, "result.json"),
    JSON.stringify(
      {
        label,
        brief: brief.id,
        ok,
        error,
        durationMs,
        verifyMs,
        lessonTotals,
        allTotals,
        scores: scored?.scores ?? null,
        rationales: scored?.rubricRationales ?? null,
        lab,
        snapshots: snapshots.map(({ findings, ...s }) => ({ ...s, findings: findings.length })),
      },
      null,
      2,
    ),
  );
  console.log(R.slice(0, 8).join("\n"));
  console.log(`\nwrote ${dir}`);
  process.exit(ok ? 0 : 1);
}
