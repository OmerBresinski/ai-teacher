#!/usr/bin/env bun
// bun packages/generation/eval/replay-r2s.ts [results-dir]
//
// Lab r2 starter wiring: replays the outline step over the saved facts of the round-1 lab runs
// (`r1-*`, default under the r1m worktree's results), no model calls. Each run twice:
// - as saved (no `retrieval`, the v11 objectives answer): the outline must equal the one the
//   outline at 4137e52 writes (`replay/outline-from-facts.r2base.ts`, today's behaviour), the
//   facts must pass `LessonFactsSchema`, and every coded set (starter, checks, exit quiz) must
//   build (Generate prints them unvalidated, as in r1);
// - with a stand-in retrieval set of three: the starter must carry no lesson question and print
//   the three as a valid starter spec, the facts must still parse, the deck keep its length, and
//   every other entry keep its kind and refs except where the freed questions went.
// Prints one row per run and exits non-zero on any failure.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { type Lesson, LessonFactsSchema } from "@tj/domain/documents";
import { SlideSpecSchema } from "@tj/slides";
import { codedSetSpec } from "../src/lab/coded-slides";
import { withExitAsPlanned } from "../src/lab/plan-pipeline";
import { outlineFromFacts } from "../src/outline-from-facts";
import { assignFactIds, type PlanFactsLike } from "../src/specs";
import { shapeOf } from "../src/stages/shared";
import { loadRunFacts } from "./from-facts";
import { outlineFromFacts as outlineBase } from "./replay/outline-from-facts.r2base";

const DEFAULT = join(import.meta.dir, "../../../../r1m/packages/generation/eval/results/lab");
const root = process.argv[2] ?? DEFAULT;
const STAND_IN = [
  { question: "Stand-in retrieval question one?", answer: "One" },
  { question: "Stand-in retrieval question two?", answer: "Two" },
  { question: "Stand-in retrieval question three?", answer: "Three" },
];

const CODED_SETS = new Set(["starter", "instructions", "exit-ticket"]);
const runs = (await readdir(root)).filter((d) => /^r1-.*-L$/.test(d)).sort();
const rows: string[] = [
  "| run | slides saved / no retrieval | outline = 4137e52 | facts valid | coded sets built | with retrieval: slides, starter | kinds changed |",
  "|---|---|---|---|---|---|---|",
];
let failures = 0;
for (const run of runs) {
  const saved = await loadRunFacts(join(root, run));
  const lesson = JSON.parse(await Bun.file(join(saved.dir, "lesson.json")).text()) as Lesson;
  const brief = lesson.brief;
  if (!brief) continue;
  const slideCount = brief.slideCount ?? 10;
  const input = {
    topic: brief.topic,
    objectives: saved.objectives.map((o) => ({ text: o.text })),
    facts: saved.facts,
    shape: shapeOf(lesson),
    slideCount,
    priorKnowledge: brief.classContext?.priorKnowledge,
  };
  const build = (retrieval?: typeof STAND_IN, base = false) => {
    const outline = base ? outlineBase(input) : outlineFromFacts({ ...input, retrieval });
    const planFacts = { ...saved.facts, outlineFactRefs: outline.outlineFactRefs } as PlanFactsLike;
    const assigned = withExitAsPlanned(
      assignFactIds(outline.skeleton, planFacts, brief.durationMin),
      outline.outlineFactRefs,
    );
    return retrieval ? { ...assigned, retrieval } : assigned;
  };
  const shape = (f: { outline: { kind: string; factRefs: string[] }[] }) =>
    f.outline.map((e) => `${e.kind}:${e.factRefs.join(",")}`).join(" ");
  const facts = build();
  const questionIn = (e: { factRefs: string[] }) =>
    e.factRefs.some((id) => facts.questions.some((q) => q.id === id));
  const same = shape(facts) === shape(build(undefined, true));
  const valid = LessonFactsSchema.safeParse(facts).success;
  const specs = facts.outline.flatMap((e, i) => {
    const coded = codedSetSpec(e, facts, `${run}:${i}`);
    const set = e.kind === "exit-ticket" || (CODED_SETS.has(e.kind) && questionIn(e));
    return set ? [coded !== undefined] : [];
  });
  const specsOk = specs.every(Boolean);

  const withSet = build(STAND_IN);
  const at = withSet.outline.findIndex((e) => e.kind === "starter");
  const qids = new Set(withSet.questions.map((q) => q.id));
  const starter = withSet.outline[at];
  const coded = starter ? codedSetSpec(starter, withSet, `${run}:${at}`) : undefined;
  const items = (coded?.spec as { items?: string[] } | undefined)?.items ?? [];
  const retrievalOk =
    at < 0 ||
    (!starter?.factRefs.some((id) => qids.has(id)) &&
      items.join("|") === STAND_IN.map((r) => r.question).join("|") &&
      SlideSpecSchema.safeParse(coded?.spec).success &&
      LessonFactsSchema.safeParse(withSet).success &&
      withSet.outline.length === facts.outline.length);
  const kindsChanged = withSet.outline.filter((e, i) => e.kind !== facts.outline[i]?.kind).length;
  const ok = same && valid && specsOk && retrievalOk;
  if (!ok) failures += 1;
  rows.push(
    `| ${run} | ${saved.lessonFacts.outline.length} / ${facts.outline.length} of ${slideCount} | ${same ? "y" : "NO"} | ${valid ? "y" : "NO"} | ${specs.filter(Boolean).length}/${specs.length} | ${at < 0 ? "no starter" : retrievalOk ? `${withSet.outline.length}/${slideCount}, slide ${at + 1}, ${items.length} items` : "NO"} | ${kindsChanged} |`,
  );
}
console.log(rows.join("\n"));
console.log(`\n${runs.length} runs, ${failures} failing`);
if (failures > 0) process.exit(1);
