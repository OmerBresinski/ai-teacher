#!/usr/bin/env bun
// bun packages/generation/eval/replay-pw-exit.ts [--glob l2-]
//
// pw prompts-2 (24 Sep): the exit ticket on saved waves runs, no model calls. Per run, the exit
// sets as the question-set calls wrote them (calls.jsonl, `forms` and distractors intact): how many
// fit a line of the exit quiz (`fitsExitLine`) and how many sets repeat a question
// (`questionSetProblem`). Then the saved facts, forms restored from those calls, through the
// outline at a135854 (`eval/replay/outline-from-facts.pw2.ts`) and the current one: exit items,
// objectives the exit ticket leaves untested, and pairs on it that ask the same thing.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Lesson } from "@tj/domain/documents";
import { sameQuestion } from "../src/lab/coded-slides";
import { fitsExitLine, questionSetProblem } from "../src/lab/plan-pipeline";
import { type OutlineFromFactsResult, outlineFromFacts } from "../src/outline-from-facts";
import {
  type PlanQuestionSetOutput,
  planQuestionSetOutputSchemaFor,
} from "../src/prompts/plan-question-set";
import { shapeOf } from "../src/stages/shared";
import { toOutlineFacts } from "./from-facts";
import { outlineFromFacts as outlineBefore } from "./replay/outline-from-facts.pw2";

const ROOT = join(import.meta.dir, "results", "lab");
const glob = process.argv[process.argv.indexOf("--glob") + 1] ?? "l";
type Q = PlanQuestionSetOutput["questions"][number];

const tot = { exitQs: 0, fit: 0, setRepeats: 0, sets: 0 };
const sum = { before: { untested: 0, repeats: 0 }, after: { untested: 0, repeats: 0 } };
const runs = (await readdir(ROOT)).filter((r) => /^l[12]-/.test(r) && r.startsWith(glob)).sort();
for (const run of runs) {
  const calls = (await readFile(join(ROOT, run, "calls.jsonl"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { promptVersion: string; prompt: string; text: string });
  const written: Q[] = [];
  for (const c of calls) {
    if (!c.promptVersion.startsWith("plan-question-set")) continue;
    const use = /Write \d+ "exit"/.test(c.prompt) ? "exit" : "slide";
    const count = Number(/Write (\d+) "/.exec(c.prompt)?.[1] ?? 0);
    let out: PlanQuestionSetOutput;
    try {
      out = JSON.parse(c.text.slice(c.text.indexOf("{"), c.text.lastIndexOf("}") + 1));
    } catch {
      continue;
    }
    // As the pipeline reads it: through the soft schema (bare-string distractors become `{ text }`).
    const parsed = planQuestionSetOutputSchemaFor(
      { use, count, taught: { keyIdeas: Array(9) } as never },
      { soft: true },
    ).safeParse(out);
    if (!parsed.success) continue;
    out = parsed.data;
    written.push(...out.questions);
    tot.sets++;
    if (questionSetProblem(out, count, 9, use)?.includes("same thing")) tot.setRepeats++;
    if (use !== "exit") continue;
    for (const q of out.questions.slice(0, count)) {
      tot.exitQs++;
      if (fitsExitLine(q)) tot.fit++;
    }
  }
  const lesson = JSON.parse(await readFile(join(ROOT, run, "lesson.json"), "utf8")) as Lesson;
  const saved = lesson.facts;
  if (!saved || !lesson.brief) continue;
  const facts = toOutlineFacts(saved);
  facts.questions = facts.questions.map((q) => {
    const w = written.find((x) => x.stem.trim() === q.stem.trim());
    return w ? { ...q, forms: w.forms, demand: w.demand, distractors: w.distractors } : q;
  }) as typeof facts.questions;
  const input = {
    topic: lesson.brief.topic,
    objectives: saved.objectives.map((o) => ({ text: o.text })),
    facts,
    shape: shapeOf(lesson),
    slideCount: lesson.brief.slideCount ?? 10,
    retrieval: saved.retrieval,
  } as Parameters<typeof outlineFromFacts>[0];
  const measure = (r: OutlineFromFactsResult) => {
    const exit = r.outlineFactRefs.find((e) => e.index === r.skeleton.outline.length - 1);
    const qs = (exit?.factRefs ?? []).flatMap((f) =>
      f.type === "question"
        ? [facts.questions[f.index] as unknown as Q & { objectiveRefs: { index: number }[] }]
        : [],
    );
    const tested = new Set(qs.flatMap((q) => q.objectiveRefs.map((o) => o.index)));
    const untested = saved.objectives.filter((_, o) => !tested.has(o)).length;
    let repeats = 0;
    qs.forEach((a, i) => {
      for (const b of qs.slice(i + 1)) if (sameQuestion(a, b)) repeats++;
    });
    return { items: exit?.factRefs.length ?? 0, untested, repeats, stems: qs.map((q) => q.stem) };
  };
  const b = measure(outlineBefore(input as never) as unknown as OutlineFromFactsResult);
  const a = measure(outlineFromFacts(input));
  sum.before.untested += b.untested;
  sum.before.repeats += b.repeats;
  sum.after.untested += a.untested;
  sum.after.repeats += a.repeats;
  console.log(
    `${run.padEnd(28)} items ${b.items}->${a.items}  untested ${b.untested}->${a.untested}  repeats ${b.repeats}->${a.repeats}`,
  );
  if (process.argv.includes("--stems"))
    console.log(`   before: ${b.stems.join(" | ")}\n   after:  ${a.stems.join(" | ")}`);
}
console.log(
  `exit questions written ${tot.exitQs}, fit a line ${tot.fit}; sets ${tot.sets}, sets repeating a question ${tot.setRepeats}`,
);
console.log(
  `exit ticket over ${runs.length} runs: untested objectives ${sum.before.untested}->${sum.after.untested}, repeat pairs ${sum.before.repeats}->${sum.after.repeats}`,
);
