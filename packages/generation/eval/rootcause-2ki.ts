#!/usr/bin/env bun
// Lab only (np1 root cause, prompts-2ki): facts v11 on saved runs' objectives, then generate-slide
// v22 on content slides that carry two key ideas. One budget for the script.
// railway run -- bun packages/generation/eval/rootcause-2ki.ts --cap 0.035 --out <dir>
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type CreatedAi, createAi, createBudget } from "@tj/ai";
import type { Lesson, LessonFacts } from "@tj/domain/documents";
import { slideSpecSchemaFor, splitAtFullStop, vocabularySlots } from "@tj/slides";
import pino from "pino";
import { callStructured } from "../src/call";
import { mergeObjectiveFacts } from "../src/merge-objective-facts";
import { outlineFromFacts } from "../src/outline-from-facts";
import { generateSlidePrompt } from "../src/prompts/generate-slide";
import {
  type PlanFactsObjectiveOutput,
  planFactsObjectiveOutputSchemaFor,
  planFactsObjectivePrompt,
} from "../src/prompts/plan-facts-objective";
import { assignFactIds, type PlanFactsLike } from "../src/specs";
import { referencedFacts } from "../src/stages/generate";
import { audienceOf, shapeOf } from "../src/stages/shared";
import { createLedger, meteringAi } from "./ledger";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const cap = Number(arg("cap") ?? 0.035);
const out = arg("out") ?? join(import.meta.dir, "results", "lab", "rootcause-2ki");
const runs = (arg("runs") ?? "np1-russian-revolution-live,np1-cells-live").split(",");
const perBrief = Number(arg("slides") ?? 2);
const MODEL = "openai/gpt-5.6-luna";

const ledger = createLedger({ run: "rootcause-2ki" });
const raw = createAi({
  AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
  AI_MODEL_STANDARD: MODEL,
});
if (raw.kind === "unconfigured") throw new Error("set AI_GATEWAY_API_KEY");
const ai = meteringAi(raw, ledger) as CreatedAi;
const budget = createBudget({ capUsd: cap, capTokens: 200_000 });
const deps = (id: string) => ({
  ai,
  budget,
  signal: new AbortController().signal,
  logger: pino({ level: "silent" }),
  context: { lessonId: id, jobId: "rootcause-2ki" },
});
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

await mkdir(out, { recursive: true });
const report: unknown[] = [];
// The ledger and whatever finished are written even when the cap stops the run part-way.
const flush = async () => {
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(join(out, "ledger.md"), ledger.markdown());
};
try {
  for (const run of runs) {
    const saved = JSON.parse(
      await readFile(join(import.meta.dir, "results", "lab", run, "lesson.json"), "utf8"),
    ) as Lesson;
    const lesson = saved;
    const objectives = (saved.facts?.objectives ?? []).map((o) => ({ text: o.text }));
    const shape = shapeOf(lesson);
    const audience = audienceOf(lesson);
    const topic = lesson.brief?.topic ?? lesson.title;

    // 1. Facts v11, one call per objective.
    // Sequential: the budget reserves each call's worst case, so parallel calls hit a small cap.
    const outputs: PlanFactsObjectiveOutput[] = [];
    for (const target of objectives.keys()) {
      outputs.push(
        await (async () => {
          const input = {
            topic,
            shape,
            audience,
            objectives,
            target,
            priorKnowledge: lesson.brief?.classContext?.priorKnowledge,
          };
          const r = await callStructured({
            deps: deps(`${run}-o${target}`),
            stage: "plan",
            cls: "standard",
            effort: "medium",
            prompt: planFactsObjectivePrompt,
            input,
            schema: planFactsObjectiveOutputSchemaFor(input, { soft: true }),
            soft: planFactsObjectiveOutputSchemaFor(input, { soft: true }),
            maxOutputTokens: 3000,
          });
          return r.output as PlanFactsObjectiveOutput;
        })(),
      );
    }
    const refCheck = outputs.map((o, target) => ({
      target,
      keyIdeas: o.keyIdeas.length,
      questions: o.questions.map((q) => ({
        stem: q.stem,
        use: q.use,
        keyIdeaRefs: q.keyIdeaRefs?.map((r) => r.index) ?? null,
        valid:
          q.keyIdeaRefs !== undefined &&
          q.keyIdeaRefs.length > 0 &&
          q.keyIdeaRefs.every((r) => r.index < o.keyIdeas.length),
      })),
      keyIdeaStatements: o.keyIdeas.map((k) => k.statement),
    }));

    // 2. Outline with and without the declarations (the fallback gate), same facts.
    const merged = (() => {
      const { duplicates: _d, ...m } = mergeObjectiveFacts(outputs);
      return m;
    })();
    const slideCount = (lesson.brief as { slideCount?: number } | undefined)?.slideCount ?? 10;
    const outlineInput = { topic, objectives, shape, slideCount: slideCount as never };
    const exact = outlineFromFacts({ ...outlineInput, facts: merged });
    const fallback = outlineFromFacts({
      ...outlineInput,
      facts: { ...merged, questions: merged.questions.map(({ keyIdeaRefs: _k, ...q }) => q) },
    });
    const placedQuestions = (o: typeof exact) =>
      o.outlineFactRefs.reduce(
        (n, e) => n + e.factRefs.filter((r) => r.type === "question").length,
        0,
      );

    const planFacts: PlanFactsLike = { ...merged, outlineFactRefs: exact.outlineFactRefs } as never;
    const facts: LessonFacts = assignFactIds(
      exact.skeleton,
      planFacts,
      lesson.brief?.durationMin ?? 60,
    );

    // 3. Generate v22 on content entries with two key ideas.
    const entries = facts.outline;
    const twoKi = entries
      .map((e, i) => ({ e, i }))
      .filter(
        ({ e }) => e.kind === "content" && e.factRefs.filter((r) => r.startsWith("k")).length >= 2,
      )
      .slice(0, perBrief);
    const slides = [];
    for (const { e, i } of twoKi) {
      const schema = slideSpecSchemaFor(e.kind, { soft: false });
      const soft = slideSpecSchemaFor(e.kind, { soft: true });
      if (!schema || !soft) throw new Error("no content schema");
      const r = await callStructured({
        deps: deps(`${run}-s${i}`),
        stage: "generate",
        cls: "standard",
        effort: "low",
        prompt: generateSlidePrompt,
        input: {
          referenced: referencedFacts(facts, e),
          entry: e,
          shape: { verb: shape.verb, confidence: shape.confidence },
          position: { index: i + 1, total: entries.length },
          neighbours: { previous: entries[i - 1]?.brief?.adds, next: entries[i + 1]?.brief?.adds },
          reservedStems: [],
          phase: e.phase,
          audience,
          vocabularySlots: vocabularySlots(lesson.themeId),
          lessonTitle: lesson.title,
        },
        schema,
        soft,
        maxOutputTokens: 1500,
      });
      const spec = r.output as { heading: string; body: string; factRefs: string[] };
      const kIds = e.factRefs.filter((id) => id.startsWith("k"));
      slides.push({
        index: i,
        keyIdeas: kIds.map((id) => ({
          id,
          statement: facts.keyIdeas?.find((k) => k.id === id)?.statement,
        })),
        heading: spec.heading,
        body: spec.body,
        bodyWords: words(spec.body),
        bodyChars: spec.body.length,
        columns: words(spec.body) > 40 ? splitAtFullStop(spec.body) : null,
        factRefs: spec.factRefs,
        echoesBothIds: kIds.every((id) => spec.factRefs.includes(id)),
      });
    }
    report.push({
      run,
      outputs,
      refCheck,
      outline: {
        exactGaps: exact.gaps,
        fallbackGaps: fallback.gaps,
        placedQuestionsExact: placedQuestions(exact),
        placedQuestionsFallback: placedQuestions(fallback),
        unplacedKeyIdeas: exact.unplaced.keyIdeas.length,
      },
      slides,
    });
  }
} finally {
  await flush();
}
console.log(JSON.stringify(report, null, 2));
console.log(ledger.markdown());
