#!/usr/bin/env bun
// bun packages/generation/eval/lab.ts --brief <id|path> --label <name> [--cap 2] [--no-judge]
//   [--no-images] [--plan-frontier-from-year N] [--from <snapshot.json>]
//   [--model <stage|prompt>=<model id>[,…]] [--only <stage>] [--effort <stage|prompt>=<low|medium|high>[,…]]
//   [--source <file>]   (a text file Plan reads as a teacher-provided Source, e.g. a curriculum extract)
//   [--lab-plan] [--no-verify] [--plan-effort low|medium|high]
//                       (the lab plan path, `src/lab/plan-pipeline.ts`: objectives call → per-objective
//                       facts calls in parallel → outline in code → the production stages after Plan.
//                       Unless `--model` says otherwise every call goes to openai/gpt-5.6-luna on the
//                       gateway and `verify-facts` to openai/gpt-6-sol; `--no-verify` makes no Verify call)
//   [--dry-run]         (print the resolved plan — every call's model, effort, cap, price — and exit; no model calls)
//   [--arm live|grounded|packed] [--pack <pack.json>] [--unfrozen]
//                       (the topic-pack experiment np1, `eval/experiments/np1.json`, with `--lab-plan`:
//                       the arm's hooks from `eval/pack-arms.ts`; the pack defaults to
//                       `eval/packs/<topic>.<packArmForLessons>.json`; every prompt's hash is recorded
//                       and must match the frozen set, or the run is refused unless `--unfrozen`)
//   [--from-facts <runDir|label>] [--verify]
//                       (np1 root cause: the lab plan path with a saved run's objectives and facts held
//                       fixed — no objectives, select or facts call; the outline is re-written in code and
//                       Generate, Illustrate, Evaluate and Repair run as usual. `--brief` defaults to the
//                       run's brief, `--label` to `<run>-ff`; Verify is OFF unless `--verify` (the facts
//                       were verified in the original run); `--arm` is refused. result.json records
//                       `fromFacts`. `--dry-run` also prints the loaded facts and the new outline.)
//
// `--from` starts the pipeline from a saved snapshot's documents (a `03-planned-*.json` replays
// Generate onward on a frozen plan); `--model` sends a stage's calls to another model id, a
// Bedrock id, a Vercel AI Gateway `provider/model` id (AI_GATEWAY_API_KEY) or an
// `openrouter/<vendor>/<model>` id (OPENROUTER_API_KEY) — the model bench. A route key is a stage
// (`plan`, `generate`, …) or a prompt name (`verify-facts`, `plan-facts`), the prompt name winning,
// so a Plan bench can pin the fact-checker to one model. `--only <stage>` runs that one stage
// function on the snapshot and stops: no downstream stage touches the output being measured.
//
// The quality lab: ONE brief through the real pipeline on Bedrock, with a snapshot of the documents
// at every persist (so each stage's output can be read on its own), the rubric judge, the
// deterministic checks, and a set of lab checks that name the defects the Chalkie audit found
// (referent without an element, answer printed beside its stem, question before its explanation,
// dropped factRefs, circular definitions, missing concretes). Everything is written under the
// gitignored `eval/results/lab/<label>/` — full content, for a person to read locally. Never run
// in CI; never log content (the pino stream below keeps warnings only).

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Writable } from "node:stream";
import { type Budget, type CreatedAi, createAi, createBudget, PRICES } from "@tj/ai";
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
import {
  evaluate,
  generate,
  noSources,
  type PhotoPlacer,
  type PipelineDeps,
  type PipelineState,
  plan,
  repair,
  runLessonPipeline,
} from "../src";
import { MAX_OUTPUT_TOKENS } from "../src/call";
import {
  LAB_PLANNED_VERSION,
  type LabFromFacts,
  type LabStatus,
  labPlanMarkdown,
  labStatusLine,
  MAX_OUTPUT_TOKENS_FACTS,
  MAX_OUTPUT_TOKENS_OBJECTIVES,
  runLabPipeline,
} from "../src/lab/plan-pipeline";
import { NUMERIC_CHECK, numericFactMismatches, numericMismatches } from "../src/numeric-check";
import { EXIT_OPTIONS_NOTE, outlineFromFacts } from "../src/outline-from-facts";
import { PROMPT_VERSIONS } from "../src/prompts";
import { planFactsObjectivePrompt } from "../src/prompts/plan-facts-objective";
import { planObjectivesPrompt } from "../src/prompts/plan-objectives";
import { objectiveVerbOf, priorConfidenceOf } from "../src/shapes";
import { distractorsEchoingAnswer, optionKey } from "../src/specs";
import { illustrate } from "../src/stages/illustrate";
import { shapeOf } from "../src/stages/shared";
import { type EvalBrief, evalBriefs, np1Briefs } from "./briefs";
import {
  checkFrozen,
  currentPromptHashes,
  type LessonArm,
  loadExperiment,
  topicForBrief,
} from "./experiments/np1";
import { loadRunFacts, type SavedRunFacts } from "./from-facts";
import { createLedger, meteringAi } from "./ledger";
import {
  admitPack,
  armHooks,
  type DroppedFact,
  MAX_OUTPUT_TOKENS_FILL,
  MAX_OUTPUT_TOKENS_SELECT,
  type SelectRecord,
} from "./pack-arms";
import { type Pack, PackSchema } from "./packs/schema";
import { evalPhotoPlacer } from "./photo-placer";
import { scoreLesson } from "./scorers";

const EnvSchema = z.object({
  AWS_BEARER_TOKEN_BEDROCK: z.string().optional(),
  AWS_REGION: z.string().optional(),
  AI_GATEWAY_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
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
      const startedAt = Date.now();
      let result: Awaited<ReturnType<typeof doGenerate>>;
      try {
        result = await doGenerate();
      } catch (error) {
        // The failure's own status and body, by stage: the pipeline's log keeps only the wrapper.
        // Walk the cause chain: `@tj/ai` wraps the provider's error, whose body names the fault.
        const chain: { statusCode?: number; message?: string; responseBody?: string }[] = [];
        for (
          let e = error as { cause?: unknown } | undefined, n = 0;
          e && n < 5;
          e = e.cause as never, n++
        ) {
          const x = e as { statusCode?: number; message?: string; responseBody?: string };
          chain.push({
            statusCode: x.statusCode,
            message: x.message,
            responseBody: x.responseBody?.slice(0, 2000),
          });
        }
        await appendFile(
          file,
          `${JSON.stringify({ stage: context?.stage, promptVersion: context?.promptVersion, durationMs: Date.now() - startedAt, error: chain })}\n`,
        );
        throw error;
      }
      const durationMs = Date.now() - startedAt;
      const text = result.content
        .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
        .join("");
      const prompt = params.prompt
        .map(
          (m) =>
            `${m.role}: ${typeof m.content === "string" ? m.content : m.content.map((c) => ("text" in c ? c.text : `[${c.type}]`)).join("")}`,
        )
        .join("\n\n");
      // The gateway prices each call itself; kept so a bench on unpriced ids can still be summed.
      const gateway = (result.providerMetadata as { gateway?: Record<string, unknown> } | undefined)
        ?.gateway;
      const gatewayCost = gateway?.cost as string | undefined;
      await appendFile(
        file,
        `${JSON.stringify({ stage: context?.stage, promptVersion: context?.promptVersion, durationMs, prompt, text, usage: result.usage, gatewayCost, gateway })}\n`,
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
  const known = [...evalBriefs(), ...np1Briefs()].find((b) => b.id === ref);
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
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

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

/** Kinds that print a question's stem with no options: an MC-native stem there asks nothing answerable. */
export const STEM_ONLY_KINDS: ReadonlySet<string> = new Set([
  "exit-ticket",
  "instructions",
  "open-response",
  "discussion",
  "starter",
]);

/** Multiple-choice is the question's native form: three or more distractors. */
export const isMcNative = (q: { distractors?: readonly unknown[] | undefined }) =>
  (q.distractors?.length ?? 0) >= 3;

const TERMINAL = /[.!?]["'”’)]*$/;

/**
 * The option tells a pupil can read without knowing the answer, by length and punctuation only:
 * `longest` — the correct option is strictly the longest; `punctuation` — it is the only option
 * that ends in terminal punctuation. Code-only: never reads what the options mean.
 */
export function mcTells(correct: string, others: readonly string[]): ("longest" | "punctuation")[] {
  const tells: ("longest" | "punctuation")[] = [];
  const c = correct.trim();
  const rest = others.map((o) => o.trim());
  if (rest.length === 0) return tells;
  if (rest.every((o) => c.length > o.length)) tells.push("longest");
  if (TERMINAL.test(c) && rest.every((o) => !TERMINAL.test(o))) tells.push("punctuation");
  return tells;
}

export function labChecks(lesson: Lesson, worksheet?: Worksheet): LabFinding[] {
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

  // (e3) A key idea no teaching slide carries (np1 RC1: the outline used to teach one per
  // objective and silently drop the rest).
  const taughtKeyIdeas = new Set(
    facts.outline
      .filter((e) => e.kind === "content" || e.kind === "image-text")
      .flatMap((e) => e.factRefs.filter((r) => kById.has(r))),
  );
  const untaughtKeyIdeas = (facts.keyIdeas ?? []).filter((k) => !taughtKeyIdeas.has(k.id));
  for (const k of untaughtKeyIdeas) {
    out.push({
      check: "key-idea-not-taught",
      detail: `${k.id} (${k.objectiveRefs.join(",")}) is on no content slide: "${k.statement.slice(0, 80)}"`,
    });
  }

  // (e4) A question on a slide whose objective has a key idea no slide teaches: a question names its
  // objective, not the key idea it tests, so it may test the untaught one.
  if (untaughtKeyIdeas.length > 0) {
    facts.outline.forEach((entry, oi) => {
      if (entry.kind === "starter" || entry.phase === "starter") return;
      for (const r of entry.factRefs) {
        const q = qById.get(r);
        if (!q) continue;
        const missing = untaughtKeyIdeas.filter((k) =>
          k.objectiveRefs.some((o) => (q.objectiveRefs ?? []).includes(o)),
        );
        if (missing.length > 0)
          out.push({
            check: "question-on-untaught-key-idea",
            slide: oi + 1,
            detail: `${entry.id} (${entry.kind}) asks ${q.id} (${q.objectiveRefs?.join(",")}); untaught on that objective: ${missing.map((k) => k.id).join(",")}`,
          });
      }
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

  // (h2) A multiple-choice-native question (three or more distractors: its native form, since
  // lesson facts keep no declared `forms`) on a step that prints only its stem. Code-only.
  // An exit ticket may set one as multiple choice: on a rendered deck its answer and distractors
  // all appear on the slide; on an outline alone, the brief names its objective for options.
  facts.outline.forEach((entry, oi) => {
    if (!STEM_ONLY_KINDS.has(entry.kind)) return;
    const slide = slides[byId.get(entry.id) ?? -1];
    const shown = slide
      ? norm(
          elementTexts(slide)
            .map((e) => e.text)
            .join("\n"),
        )
      : undefined;
    const noted = new Set(
      (entry.brief?.adds.split(EXIT_OPTIONS_NOTE)[1]?.match(/\d+/g) ?? []).map(Number),
    );
    for (const r of entry.factRefs) {
      const q = qById.get(r);
      if (!q || !isMcNative(q)) continue;
      const options = [q.answer, ...(q.distractors ?? []).map((d) => d.text)];
      const objective = facts.objectives.findIndex((o) => o.id === q.objectiveRefs?.[0]) + 1;
      const withOptions =
        entry.kind === "exit-ticket" &&
        (shown === undefined
          ? noted.has(objective)
          : options.every((t) => shown.includes(norm(t).slice(0, 30))));
      if (withOptions)
        out.push({
          check: "mc-options-on-stem-step",
          slide: oi + 1,
          detail: `${entry.id} (${entry.kind}) sets ${q.id} with its options ${shown === undefined ? "(planned)" : "(rendered)"}`,
        });
      else
        out.push({
          check: "mc-stem-without-options",
          slide: oi + 1,
          detail: `${entry.id} (${entry.kind}) asks ${q.id} without its ${q.distractors?.length} options: "${q.stem.slice(0, 80)}"`,
        });
    }
  });

  // (h3) Option tells (code-only, length and terminal punctuation): the facts' answer against its
  // distractors, and each rendered multiple-choice slide's correct option against the others.
  for (const q of facts.questions) {
    if (!isMcNative(q)) continue;
    for (const tell of mcTells(
      q.answer,
      (q.distractors ?? []).map((d) => d.text),
    ))
      out.push({ check: `mc-tell-${tell}`, detail: `${q.id} (facts): "${q.stem.slice(0, 80)}"` });
  }
  slides.forEach((slide, i) => {
    const data = slide.question;
    if (data?.type !== "multiple-choice") return;
    const text = new Map(elementTexts(slide).map((e) => [e.id, e.text]));
    const correct = data.options.filter((o) => o.correct).map((o) => text.get(o.id) ?? "");
    const others = data.options.filter((o) => !o.correct).map((o) => text.get(o.id) ?? "");
    if (correct.length !== 1 || others.length === 0) return;
    for (const tell of mcTells(correct[0] ?? "", others))
      out.push({ check: `mc-tell-${tell}`, slide: i + 1, detail: `slide ${i + 1} (${slide.id})` });
  });

  // (h4) A distractor that repeats its answer (case, spacing and sentence punctuation aside), on
  // the facts and on each rendered multiple-choice slide. Code-only.
  for (const q of facts.questions) {
    for (const j of distractorsEchoingAnswer(q))
      out.push({
        check: "distractor-equals-answer",
        detail: `${q.id} (facts) distractor ${j + 1}: "${q.answer.slice(0, 80)}"`,
      });
  }
  slides.forEach((slide, i) => {
    const data = slide.question;
    if (data?.type !== "multiple-choice") return;
    const text = new Map(elementTexts(slide).map((e) => [e.id, e.text]));
    const correct = new Set(
      data.options.filter((o) => o.correct).map((o) => optionKey(text.get(o.id) ?? "")),
    );
    for (const o of data.options) {
      if (!o.correct && correct.has(optionKey(text.get(o.id) ?? "")))
        out.push({
          check: "distractor-equals-answer",
          slide: i + 1,
          detail: `slide ${i + 1} (${slide.id})`,
        });
    }
  });

  // (h5) Arithmetic that does not work out (`numeric-check.ts`, code, no model): the facts'
  // authoritative text, then what the deck teaches — content and worked-example slides and each
  // multiple-choice slide's correct option. Stems, distractors and true/false statements may be
  // wrong on purpose and are not read.
  for (const m of numericFactMismatches(facts))
    out.push({
      check: NUMERIC_CHECK,
      detail: `${m.factId}.${m.field}${m.index === undefined ? "" : `[${m.index}]`} (facts): "${m.text}" (${round4(m.left)} vs ${round4(m.right)})`,
    });
  slides.forEach((slide, i) => {
    const data = slide.question;
    const correctIds = new Set(
      data?.type === "multiple-choice"
        ? data.options.filter((o) => o.correct).map((o) => o.id)
        : [],
    );
    const taught = slide.kind === "content" || slide.kind === "worked-example";
    for (const el of elementTexts(slide)) {
      if (!taught && !correctIds.has(el.id)) continue;
      for (const m of numericMismatches(el.text))
        out.push({
          check: NUMERIC_CHECK,
          slide: i + 1,
          detail: `slide ${i + 1} (${slide.id}) ${el.id}: "${m.text}" (${round4(m.left)} vs ${round4(m.right)})`,
        });
    }
  });

  // (h6) The objectives slide names every objective (cardiac-L-1, w0): each objective's text,
  // case and spacing aside, appears on it. Code-only.
  slides.forEach((slide, i) => {
    if (slide.kind !== "objectives") return;
    const shown = norm(
      elementTexts(slide)
        .map((e) => e.text)
        .join("\n"),
    );
    const missing = facts.objectives.filter((o) => !shown.includes(norm(o.text).slice(0, 40)));
    if (missing.length > 0)
      out.push({
        check: "objectives-slide-incomplete",
        slide: i + 1,
        detail: `slide ${i + 1} shows ${facts.objectives.length - missing.length} of ${facts.objectives.length} objectives; missing ${missing.map((o) => o.id).join(",")}`,
      });
  });

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
    `## Outline (${facts.outline.length} slides after title and objectives; ${facts.durationMin} min lesson)`,
  );
  facts.outline.forEach((e, i) => {
    L.push(
      `${i + 1}. ${e.id} **${e.kind}** [${e.phase ?? "-"}]${e.minutes === undefined ? "" : ` ${e.minutes} min;`} refs ${e.factRefs.join(",")}`,
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

/**
 * `--from-facts --dry-run`: what was loaded and the outline the code writes from it now — the
 * plan Generate would be handed (content slides with the key ideas they carry). No model call.
 */
export function fromFactsDryRun(saved: SavedRunFacts, lesson: Lesson): string[] {
  const f = saved.facts;
  const out = outlineFromFacts({
    topic: lesson.brief?.topic ?? "",
    objectives: saved.objectives.map((o) => ({ text: o.text })),
    facts: f,
    shape: shapeOf(lesson),
    slideCount: lesson.brief?.slideCount ?? 10,
  });
  const kinds = out.skeleton.outline.map((e, i) => {
    const kis = (out.outlineFactRefs.find((x) => x.index === i)?.factRefs ?? [])
      .filter((r) => r.type === "keyIdea")
      .map((r) => `k${r.index + 1}`);
    return kis.length ? `${e.kind}[${kis.join("+")}]` : e.kind;
  });
  return [
    `from facts: ${saved.run} (${saved.factsFrom}; original arm ${saved.arm ?? "-"})`,
    `- objectives (${saved.objectives.length}): ${saved.objectives.map((o, i) => `${i + 1}. ${o.text}`).join(" | ")}`,
    `- facts: key ideas ${f.keyIdeas.length}, misconceptions ${f.misconceptions.length}, vocabulary ${f.vocabulary.length}, worked examples ${f.workedExamples.length}, questions ${f.questions.length}`,
    `- outline handed to Generate (${kinds.length} slides): ${kinds.join(" ")}`,
    `- unplaced key ideas ${out.unplaced.keyIdeas.length}; gaps ${out.gaps.length}${out.gaps.length ? `: ${out.gaps.join(" | ")}` : ""}`,
  ];
}

/* ----------------------------------------------------------------------------------------- */

if (import.meta.main) {
  const env = EnvSchema.parse(process.env);
  // `--from-facts`: a saved run's objectives and facts, held fixed (the brief and label follow it).
  const fromFactsRef = arg("from-facts");
  const saved: SavedRunFacts | undefined = fromFactsRef
    ? await loadRunFacts(fromFactsRef)
    : undefined;
  const briefRef = arg("brief") ?? saved?.briefId;
  const label = arg("label") ?? (saved ? `${saved.run}-ff` : undefined);
  if (!briefRef || !label) {
    console.error(
      "usage: lab.ts --brief <id|path> --label <name> [--cap usd] [--no-judge] [--no-images] [--plan-frontier-from-year N]\n       lab.ts --from-facts <runDir|label> [--verify] [--cap usd] [--no-judge] [--no-images]",
    );
    process.exit(2);
  }
  if (saved && saved.briefId !== briefRef)
    throw new Error(`--from-facts: the run is brief ${saved.briefId}, --brief says ${briefRef}`);
  const capUsd = Number(arg("cap") ?? 2);
  const labPlanOn = flag("lab-plan") || saved !== undefined;
  /** Verify under `--from-facts` is opt-in (`--verify`): the facts were verified when written. */
  const verifyOn = saved ? flag("verify") : !flag("no-verify");
  /**
   * The lab plan path's default routing (decisions of 23 Sept 2026: gpt-5.6-luna writes
   * everything, gpt-6-sol fact-checks, Bedrock is dead): every stage to Luna on the gateway, the
   * fact check to Sol. `--model` overrides any key.
   */
  const LAB_PLAN_ROUTES: Record<string, string> = {
    plan: "openai/gpt-5.6-luna",
    generate: "openai/gpt-5.6-luna",
    illustrate: "openai/gpt-5.6-luna",
    evaluate: "openai/gpt-5.6-luna",
    repair: "openai/gpt-5.6-luna",
    "verify-facts": "openai/gpt-6-sol",
  };
  /** `--model plan=openai/gpt-5.6-sol,generate=google/gemini-3.8-flash`: stage → model id. */
  const routes: Record<string, string> = {
    ...(labPlanOn ? LAB_PLAN_ROUTES : {}),
    ...Object.fromEntries(
      (arg("model") ?? "")
        .split(",")
        .filter(Boolean)
        .map((pair) => {
          const [stage, id] = pair.split("=");
          if (!stage || !id) throw new Error(`--model: expected <stage>=<model id>, got "${pair}"`);
          return [stage.trim(), id.trim()];
        }),
    ),
  };
  const planEffort = arg("plan-effort") as "low" | "medium" | "high" | undefined;
  if (planEffort && !["low", "medium", "high"].includes(planEffort))
    throw new Error(`--plan-effort: expected low|medium|high, got "${planEffort}"`);
  // The topic-pack experiment's arm (np1): its models join the routes, its prompt set is checked
  // against the frozen hashes, and its pack is loaded before anything is paid for.
  const armName = arg("arm") as LessonArm | undefined;
  const experiment = armName ? loadExperiment() : undefined;
  if (armName && !experiment?.lessonArms.includes(armName))
    throw new Error(`--arm: expected ${experiment?.lessonArms.join("|")}, got "${armName}"`);
  if (armName && !labPlanOn) throw new Error("--arm needs --lab-plan");
  if (armName && saved)
    throw new Error("--arm and --from-facts do not combine: an arm only changes the facts");
  const promptHashes = currentPromptHashes();
  const frozen = experiment ? checkFrozen(experiment, promptHashes) : null;
  if (frozen && !frozen.ok && !flag("unfrozen") && !flag("dry-run")) {
    console.error(
      `lab: prompt hashes do not match ${experiment?.id}'s frozen set (changed ${frozen.changed.join(",") || "-"}; added ${frozen.added.length}; removed ${frozen.removed.length}); pass --unfrozen to run anyway (the run is marked unfrozen)`,
    );
    process.exit(2);
  }
  if (experiment && armName && armName !== "live") {
    routes["pack-select"] ??= experiment.models.select ?? "openai/gpt-5.6-luna";
    if (armName === "packed")
      routes["pack-fill"] ??= experiment.models.lesson ?? "openai/gpt-5.6-luna";
  }
  const promptName = (version: string | undefined) => version?.replace(/\.v\d+$/, "");
  /** `--effort plan=low,verify-facts=medium`: stage or prompt name → reasoning effort. */
  const efforts: Record<string, "low" | "medium" | "high"> = Object.fromEntries(
    (arg("effort") ?? "")
      .split(",")
      .filter(Boolean)
      .map((pair) => {
        const [key, level] = pair.split("=");
        if (!key || !level || !["low", "medium", "high"].includes(level))
          throw new Error(`--effort: expected <stage|prompt>=<low|medium|high>, got "${pair}"`);
        return [key.trim(), level as "low" | "medium" | "high"];
      }),
  );
  /**
   * Verify's output cap under a Luna checker: 2 000, not production's 4 000. Luna answers the
   * check short (166 output tokens on the Romans facts, wf1-romans-1b) and the budget reserves
   * the cap at list price before the call, so the production cap would refuse the call under a
   * small `--cap`. Any other checker (Sol, the default) keeps production's cap.
   */
  const LAB_VERIFY_LUNA_MAX_OUTPUT_TOKENS = 2000;
  const verifyMaxOutputTokens = /luna/i.test(routes["verify-facts"] ?? "")
    ? LAB_VERIFY_LUNA_MAX_OUTPUT_TOKENS
    : undefined;
  const created = createAi(env, {
    route: (_cls, context) =>
      routes[promptName(context?.promptVersion) ?? ""] ??
      (context?.stage ? routes[context.stage] : undefined),
  });
  if (created.kind === "unconfigured") {
    console.error("lab: set AWS_BEARER_TOKEN_BEDROCK, AI_GATEWAY_API_KEY or OPENROUTER_API_KEY");
    process.exit(2);
  }
  const label0 = label;
  const recordFile = join(import.meta.dir, "results", "lab", label0, "calls.jsonl");
  await mkdir(join(import.meta.dir, "results", "lab", label0), { recursive: true });
  // Every call is metered into the lesson's cost ledger (per stage, priced from `PRICES`): THE
  // cost figure of the run; the budget's totals are shown only as what was reserved and settled.
  const ledger = createLedger({ run: label0 });
  const ai = meteringAi(flag("record") ? recordingAi(created, recordFile) : created, ledger);
  const judgeCreated: CreatedAi | undefined = flag("no-judge")
    ? undefined
    : createAi({ ...env, AI_MODEL_FRONTIER: env.AI_MODEL_JUDGE ?? ai.modelId("frontier") });
  if (judgeCreated && judgeCreated.kind === "unconfigured") throw new Error("judge unconfigured");
  const judge = judgeCreated && meteringAi(judgeCreated, ledger, { stage: "judge" });
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
  let pack: Pack | undefined;
  let packDropped: DroppedFact[] | null = null;
  if (experiment && armName && armName !== "live") {
    const topic = topicForBrief(experiment, brief.id);
    const packPath =
      arg("pack") ??
      (topic
        ? join(import.meta.dir, "packs", `${topic.id}.${experiment.packArmForLessons}.json`)
        : undefined);
    if (!packPath) throw new Error(`lab: no pack topic for brief ${brief.id} in ${experiment.id}`);
    const raw = await readFile(resolve(packPath), "utf8").catch(() => null);
    // A dry run may precede the pack (it is written by `pack-author.ts`); a live run needs it.
    if (raw === null && !flag("dry-run")) throw new Error(`lab: pack not found at ${packPath}`);
    if (raw !== null) pack = PackSchema.parse(JSON.parse(raw));
    // The pre-registered admission rule: only facts both checkers passed reach the arm. The
    // verdicts are the pack author's recorded report; a live run with a rule needs it.
    if (pack && experiment.packAdmission) {
      const reportPath = join(import.meta.dir, "results", "packs", pack.id, "report.json");
      const report = await readFile(reportPath, "utf8").catch(() => null);
      if (report === null) {
        if (!flag("dry-run")) throw new Error(`lab: pack check report not found at ${reportPath}`);
      } else {
        const admitted = admitPack(pack, JSON.parse(report), experiment.packAdmission);
        pack = PackSchema.parse(admitted.pack);
        packDropped = admitted.dropped;
      }
    }
  }

  const budget = createBudget({ capUsd, capTokens: 2 * env.AI_LESSON_TOKEN_CAP });
  const startedAt = Date.now();
  const now = () => new Date();
  let counter = 0;
  const ids = () => `lab${(++counter).toString(36)}`;
  let lesson = lessonFromBrief(brief.input, `lab-${brief.id}`, now());
  let worksheet: Worksheet | undefined;
  // `--source <file>`: the file's text as the lesson's one Source (ADR 0027), the way a teacher's
  // upload reaches Plan — here a curriculum extract, to measure grounding against no source.
  const sourcePath = arg("source");
  let sources = noSources;
  if (sourcePath) {
    const text = await readFile(resolve(sourcePath), "utf8");
    const name = sourcePath.split("/").pop() ?? "source.md";
    lesson = { ...lesson, sources: [{ id: "lab-src", kind: "paste", name }] };
    sources = async () => [{ sourceId: "lab-src", ref: { section: name.slice(0, 120) }, text }];
  }
  const from = arg("from");
  if (from) {
    // A saved snapshot's documents; the pipeline resumes after their checkpoint (ADR 0025 §5).
    const saved = JSON.parse(await readFile(resolve(from), "utf8")) as {
      lesson: Lesson;
      worksheet?: Worksheet;
    };
    lesson = sourcePath
      ? {
          ...saved.lesson,
          sources: [
            { id: "lab-src", kind: "paste", name: sourcePath.split("/").pop() ?? "source.md" },
          ],
        }
      : saved.lesson;
    worksheet = saved.worksheet;
  }
  const snapshots: Snapshot[] = [];
  let verifyMs: number | null = null;
  let verifyCorrections: number | null = null;
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
            if (rec.msg === "facts verified" && typeof rec.durationMs === "number") {
              verifyMs = rec.durationMs;
              verifyCorrections = (rec as { corrections?: number }).corrections ?? null;
            }
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
    sources,
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
    effortFor: (stage, name, effort) => efforts[name] ?? efforts[stage] ?? effort,
    ...(images ? { images } : {}),
    ...(planFrontierFromYear !== undefined ? { planFrontierFromYear } : {}),
  };

  const only = arg("only");
  if (flag("dry-run")) {
    // The calls each stage makes (mirrors the stage files; effort and cap as they set them).
    const objectiveCount = 3;
    const CALLS: Record<string, [prompt: string, cls: string, effort: string, cap: number][]> = {
      ...(labPlanOn
        ? {}
        : { "check-input": [["check-input", "small", "low", MAX_OUTPUT_TOKENS.checkInput]] }),
      plan: saved
        ? verifyOn
          ? [["verify-facts", "standard", "low", verifyMaxOutputTokens ?? MAX_OUTPUT_TOKENS.verify]]
          : []
        : labPlanOn
          ? [
              ["plan-objectives", "standard", planEffort ?? "medium", MAX_OUTPUT_TOKENS_OBJECTIVES],
              // One per objective, in parallel; three is the usual count at ten slides.
              ...Array.from({ length: objectiveCount }, (): [string, string, string, number] => [
                "plan-facts-objective",
                "standard",
                planEffort ?? "medium",
                MAX_OUTPUT_TOKENS_FACTS,
              ]),
              ...(!verifyOn
                ? []
                : [
                    [
                      "verify-facts",
                      "standard",
                      "low",
                      verifyMaxOutputTokens ?? MAX_OUTPUT_TOKENS.verify,
                    ] as [string, string, string, number],
                  ]),
              // An arm's lookup: one select per objective; the packed arm fills the types a
              // matched section lacks (the file's fill rate says how often).
              ...(armName && armName !== "live"
                ? Array.from({ length: objectiveCount }, (): [string, string, string, number] => [
                    "pack-select",
                    "standard",
                    "low",
                    MAX_OUTPUT_TOKENS_SELECT,
                  ])
                : []),
              ...(armName === "packed"
                ? Array.from(
                    { length: Math.ceil(objectiveCount * (experiment?.estimates.fillRate ?? 0.5)) },
                    (): [string, string, string, number] => [
                      "pack-fill",
                      "standard",
                      "medium",
                      MAX_OUTPUT_TOKENS_FILL,
                    ],
                  )
                : []),
            ]
          : [
              ["plan-skeleton", "standard", "medium", MAX_OUTPUT_TOKENS.planSkeleton],
              ["plan-facts", "standard", "medium", MAX_OUTPUT_TOKENS.planFacts],
              ["verify-facts", "standard", "low", MAX_OUTPUT_TOKENS.verify],
            ],
      generate: [
        ["generate-slide", "small", "low", MAX_OUTPUT_TOKENS.slide],
        ["generate-worksheet", "small", "low", MAX_OUTPUT_TOKENS.worksheet],
      ],
      illustrate: [
        ["shortlist-photos", "small", "low", MAX_OUTPUT_TOKENS.shortlist],
        ["pick-or-requery-photo", "standard", "low", 300],
      ],
      evaluate: [["evaluate", "standard", "medium", MAX_OUTPUT_TOKENS.evaluate]],
      repair: [["repair", "small", "low", MAX_OUTPUT_TOKENS.repair]],
    };
    const stages = only ? [only] : Object.keys(CALLS);
    // Only the overrides a person typed are refused when they match no call; the path's own
    // default routes (a `verify-facts` route under `--no-verify`) are not a typo to catch.
    const typedRoutes = (arg("model") ?? "")
      .split(",")
      .filter(Boolean)
      .map((pair) => pair.split("=")[0]?.trim() ?? "");
    const unused = new Set([...typedRoutes, ...Object.keys(efforts)]);
    const L: string[] = [];
    let total = 0;
    L.push(
      `brief ${brief.id}; snapshot ${from ?? "-"} (stage ${lesson.generation?.stage ?? "none"}, ${lesson.slides.length} slides); source ${sourcePath ?? "-"}; cap $${capUsd}; stages ${stages.join(",")}${labPlanOn ? `; lab plan (${planObjectivesPrompt.version}, ${planFactsObjectivePrompt.version} × ${objectiveCount}, verify ${verifyOn ? "on" : "off"}${saved ? `; FROM FACTS of ${saved.run} (${saved.factsFrom}): no objectives/select/facts call` : ""})` : ""}${armName ? `; arm ${armName}${pack ? ` on pack ${pack.id} (${pack.sections.length} sections${packDropped ? `, ${packDropped.length} facts not admitted` : ""})` : ""}; prompts ${frozen?.ok ? "frozen" : "NOT frozen"}` : ""}`,
    );
    L.push(
      "| stage | call | class | model id | via | effort | out cap | $/M in/out | est. reservation |",
      "|---|---|---|---|---|---|---:|---|---:|",
    );
    for (const stage of stages) {
      for (const [name, cls, defaultEffort, cap] of CALLS[stage] ?? []) {
        const routedId = routes[name] ?? routes[stage] ?? ai.modelId(cls as never);
        for (const k of [name, stage]) unused.delete(k);
        const effort = efforts[name] ?? efforts[stage] ?? defaultEffort;
        const price = PRICES[routedId];
        const via = routedId.startsWith("openai/")
          ? "openai (pinned)"
          : routedId.includes("/")
            ? "gateway"
            : "bedrock";
        const est = price
          ? ((3000 * price.inputPerMTok + cap * price.outputPerMTok) / 1e6).toFixed(3)
          : "unpriced→token cap";
        total += price ? (3000 * price.inputPerMTok + cap * price.outputPerMTok) / 1e6 : 0;
        L.push(
          `| ${stage} | ${name} | ${cls} | ${routedId} | ${via} | ${effort} | ${cap} | ${price ? `${price.inputPerMTok}/${price.outputPerMTok}` : "-"} | ${est} |`,
        );
      }
    }
    L.push(`worst-case reservation over priced calls: $${total.toFixed(3)}`);
    if (saved) L.push("", ...fromFactsDryRun(saved, lesson));
    if (unused.size) L.push(`REFUSED: overrides that match no call: ${[...unused].join(", ")}`);
    console.log(L.join("\n"));
    process.exit(unused.size ? 2 : 0);
  }
  const stageFns: Record<
    string,
    (state: PipelineState, deps: PipelineDeps) => Promise<PipelineState>
  > = { plan, generate, illustrate, evaluate, repair };
  if (only && !stageFns[only]) {
    console.error(`lab: --only must be one of ${Object.keys(stageFns).join(", ")}`);
    process.exit(2);
  }

  // Three statuses, never one "ok": `executed` (the run reached the end), `complete` (every
  // objective taught and practised or exit-checked, no failed facts call, no objectives issue;
  // the lab plan path computes it, the other paths take it from the final findings), `accepted`
  // (the judge's verdict, `null` until it is given — the rubric is not yet an accept/reject).
  let executed = true;
  let error: string | undefined;
  const selections: SelectRecord[] = [];
  let labPlanReport: Awaited<ReturnType<typeof runLabPipeline>>["report"] | undefined;
  let labStatus: LabStatus | undefined;
  try {
    if (labPlanOn) {
      if (only || from)
        throw new Error("lab: --lab-plan runs the whole pipeline; drop --only / --from");
      const labArm = armName
        ? armHooks(
            armName,
            pack,
            { subject: lesson.subject ?? "", yearGroup: lesson.yearGroup ?? "" },
            { deps, selections },
          )
        : undefined;
      const result = await runLabPipeline({ lesson, worksheetId: `lab-${brief.id}-ws` }, deps, {
        verify: verifyOn,
        ...(saved
          ? {
              fromFacts: {
                source: saved.run,
                objectives: saved.objectives,
                facts: saved.facts as unknown as LabFromFacts["facts"],
              },
            }
          : {}),
        verifyMaxOutputTokens,
        ...(planEffort ? { effort: planEffort } : {}),
        ...(labArm ? { arm: labArm } : {}),
      });
      lesson = result.state.lesson;
      worksheet = result.state.worksheet;
      labPlanReport = result.report;
      labStatus = result.status;
      executed = result.status.executed;
      // Not executed: the objectives check blocked the run, or a stage after Plan threw (the
      // status names it first).
      if (!executed)
        error =
          result.report.objectiveIssues.length > 0
            ? `blocked: ${result.report.objectiveIssues.join("; ")}`
            : (result.status.incomplete[0] ?? "did not run to the end");
    } else if (only) {
      // One stage on the snapshot's documents, nothing after it. Plan hands Verify on as a
      // promise for Generate to await; here the lab awaits it and keeps the corrected facts.
      const run = stageFns[only];
      if (!run) throw new Error("unreachable");
      let state = await run(
        { lesson, ...(worksheet ? { worksheet } : {}), worksheetId: `lab-${brief.id}-ws` },
        deps,
      );
      if (state.pendingVerify) {
        const result = await state.pendingVerify;
        const generation = state.lesson.generation;
        state = {
          ...state,
          lesson: {
            ...state.lesson,
            facts: result.facts,
            ...(generation
              ? {
                  generation: {
                    ...generation,
                    findings: [...generation.findings, ...result.findings],
                  },
                }
              : {}),
          },
        };
      }
      lesson = state.lesson;
      worksheet = state.worksheet;
      await deps.persist(lesson, worksheet);
    } else {
      const final = await runLessonPipeline({ lesson, worksheetId: `lab-${brief.id}-ws` }, deps);
      lesson = final.lesson;
      worksheet = final.worksheet;
    }
  } catch (e) {
    executed = false;
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    process.stderr.write(`pipeline failed: ${error}\n`);
  }
  const durationMs = Date.now() - startedAt;
  const budgetTotals = budget.totals();

  const scored =
    executed && lesson.facts
      ? await scoreLesson(
          brief.id,
          { lesson, worksheet },
          judge ? { ai: judge, budget, signal, context } : undefined,
        )
      : null;

  const schemaFindings = checkLesson(lesson, worksheet);
  const lab = labChecks(lesson, worksheet);
  const status: LabStatus = labStatus ?? {
    executed,
    // Without the lab plan report, "complete" is read off the documents: no budget stop and no
    // error-severity schema finding (an objective untaught or unchecked is one).
    complete:
      executed &&
      !(lesson.generation?.findings ?? []).some((f) => f.check === "budget") &&
      !schemaFindings.some((f) => f.severity === "error"),
    incomplete: [
      ...(executed ? [] : [error ?? "did not run to the end"]),
      ...(lesson.generation?.findings ?? [])
        .filter((f) => f.check === "budget")
        .map((f) => f.message),
      ...schemaFindings.filter((f) => f.severity === "error").map((f) => f.message),
    ],
    accepted: null,
  };
  // The judge's rubric is a mean, not a verdict: `accepted` stays null and the lesson does not yet
  // count toward cost-per-accepted-lesson. A run that did not execute or finish complete never will.
  ledger.setRun({ countsTowardAccepted: status.executed && status.complete ? null : false });

  await writeFile(join(dir, "lesson.json"), JSON.stringify(lesson, null, 2));
  if (worksheet) await writeFile(join(dir, "worksheet.json"), JSON.stringify(worksheet, null, 2));
  if (lesson.facts) await writeFile(join(dir, "facts.md"), factsMarkdown(lesson.facts));
  await writeFile(join(dir, "slides.md"), slidesMarkdown(lesson, worksheet));
  await writeFile(join(dir, "log.jsonl"), logLines.join(""));

  const R: string[] = [];
  R.push(`# Lab run ${label} — ${brief.id}`, "");
  R.push(`- status: ${labStatusLine(status)}${error ? ` (${error})` : ""}`);
  R.push(
    `- ${lesson.slides.length} slides, ${worksheet?.blocks.length ?? 0} blocks; duration ${(durationMs / 1000).toFixed(1)} s; verify ${verifyMs ?? "-"} ms, ${verifyCorrections ?? "-"} corrections${only ? `; only ${only}` : ""}`,
  );
  R.push(
    `- models: frontier ${ai.modelId("frontier")}, standard ${ai.modelId("standard")}, small ${ai.modelId("small")}; judge ${judge?.modelId("frontier") ?? "-"}; planFrontierFromYear ${planFrontierFromYear ?? "-"}; routes ${JSON.stringify(routes)}; efforts ${JSON.stringify(efforts)}${from ? `; from ${from}` : ""}${sourcePath ? `; source ${sourcePath}` : ""}`,
  );
  R.push(
    `- prompt versions in code: ${Object.entries(PROMPT_VERSIONS)
      .map(([, v]) => v)
      .join(", ")}`,
  );
  R.push(`- prompt versions on lesson: ${JSON.stringify(lesson.generation?.promptVersions ?? {})}`);
  if (armName) {
    R.push(
      `- experiment ${experiment?.id}: arm ${armName}${pack ? `, pack ${pack.id} (${pack.arm}, written ${pack.writtenAt})` : ""}; prompts ${frozen?.ok ? "match the frozen set" : `UNFROZEN (changed ${frozen?.changed.join(",") || "-"}, added ${frozen?.added.length}, removed ${frozen?.removed.length})`}`,
    );
    for (const s of selections)
      R.push(
        `  - select "${s.objective}" → ${s.section ?? "none"} (${s.decision.coverage}${s.decision.missingTypes.length ? `; missing ${s.decision.missingTypes.join(",")}` : ""}${s.decision.missingConcepts.length ? `; concepts ${s.decision.missingConcepts.join("; ")}` : ""})`,
      );
  }
  if (labPlanOn) {
    R.push("", `## Lab plan (${LAB_PLANNED_VERSION})`, "");
    R.push(labPlanReport ? labPlanMarkdown(labPlanReport) : "(the plan path did not complete)");
  }
  R.push(
    `- verb ${objectiveVerbOf(lesson.brief?.answers)}, confidence ${priorConfidenceOf(lesson.brief?.answers)}, ${lesson.yearGroup} ${lesson.subject}, ${lesson.brief?.durationMin} min`,
  );
  // One cost figure: the ledger's lesson total (list price per call). The budget's settled total
  // includes the judge and is shown only when it differs, as the reservation view it is.
  const lessonCost = ledger.lessonTotal();
  const allCost = ledger.allTotal();
  const fmt = (v: number | null | undefined) =>
    v === null || v === undefined ? "-" : `$${v.toFixed(4)}`;
  const budgetDiffers =
    budgetTotals.costUsd === null ||
    allCost.usd === null ||
    Math.abs(budgetTotals.costUsd - allCost.usd) >= 0.00005;
  R.push(
    `- lesson cost ${fmt(lessonCost.usd)} (ledger: ${lessonCost.calls} calls, ${lessonCost.inputTokens}/${lessonCost.outputTokens} tokens); with judge ${fmt(allCost.usd)}${budgetDiffers ? `; budget reserved/settled ${fmt(budgetTotals.costUsd)} (${budgetTotals.calls} calls${budgetTotals.reserved ? `, ${budgetTotals.reserved.calls} still reserved` : ""}${budgetTotals.uncertain ? `, ${budgetTotals.uncertain.calls} uncertain` : ""})` : ""}`,
  );
  R.push("", "## Cost ledger", "", ledger.markdown());
  await writeFile(join(dir, "ledger.json"), JSON.stringify(ledger.toJSON(), null, 2));
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
        status,
        error,
        durationMs,
        verifyMs,
        /** The ledger's totals: the cost figure. */
        ledger: { lesson: lessonCost, all: allCost, run: ledger.run() },
        /** The budget's view (reservations, uncertain calls); never the quoted cost. */
        budgetTotals,
        scores: scored?.scores ?? null,
        rationales: scored?.rubricRationales ?? null,
        lab,
        labPlan: labPlanReport ?? null,
        /** `--from-facts`: the run whose objectives and facts this run reused, and the file read. */
        ...(saved ? { fromFacts: saved.run, fromFactsFile: saved.factsFrom } : {}),
        /** np1: the arm, the pack, every select decision, and the prompt hashes this run used. */
        experiment: armName
          ? {
              id: experiment?.id,
              arm: armName,
              pack: pack ? { id: pack.id, arm: pack.arm, writtenAt: pack.writtenAt } : null,
              admission: experiment?.packAdmission
                ? { rule: experiment.packAdmission.rule, dropped: packDropped }
                : null,
              selections,
              frozen: frozen?.ok ?? null,
              promptHashes,
            }
          : null,
        snapshots: snapshots.map(({ findings, ...s }) => ({ ...s, findings: findings.length })),
      },
      null,
      2,
    ),
  );
  console.log(R.slice(0, labPlanOn ? 9 + 5 + (labPlanReport?.gaps.length ?? 0) : 9).join("\n"));
  console.log(`\ncost ledger\n${ledger.markdown()}`);
  console.log(`\nwrote ${dir}`);
  process.exit(status.executed ? 0 : 1);
}
