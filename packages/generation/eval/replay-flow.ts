#!/usr/bin/env bun
// bun packages/generation/eval/replay-flow.ts [--md]
//
// w0b flow (24 Sep): replays the outline step over the saved facts of the w0b lab runs
// (`w0b-*-L-*`) and the 20 np1 `-ff` runs, no model calls, through the outline at ca69928
// (`eval/replay/outline-from-facts.w0b.ts`, before) and the current one (after), with the brief's
// shape, slide count and declared prior knowledge. The facts are what `--from-facts` reruns read
// (`loadRunFacts`). Saved facts keep no `demand`, `forms` or `keyIdeaRefs` (`assignFactIds` drops
// them), so nothing is simulated: checks fall back to a question's objectives, and the `apply`
// rule cannot fire. Counts per run, all structural:
// - starter: a starter slide in the first three positions after title and objectives (R: it
//   retrieves declared prior knowledge).
// - in-cycle: taught objectives whose check (a practise slide naming the objective) comes after the
//   objective's last teaching slide and before the next objective's first; of taught objectives.
// - mid checks: practise slides that come before the last teaching slide (unpractised: taught
//   objectives no practise slide names).
// - model-first: placed worked examples that come before every practise slide naming an objective
//   the example names; of placed worked examples.
// - untaught-tested: question refs on any slide but the starter where a key idea of an objective
//   the question names is on no earlier slide (the exit ticket: on no slide). Must be 0.
// - exit: items on the exit ticket. count: the outline has exactly the brief's slide count.

import { readdir } from "node:fs/promises";
import type { Lesson } from "@tj/domain/documents";
import {
  type OutlineFacts,
  type OutlineFromFactsInput,
  outlineFromFacts,
} from "../src/outline-from-facts";
import { shapeOf } from "../src/stages/shared";
import { LAB_RESULTS, loadRunFacts } from "./from-facts";
import { outlineFromFacts as outlineBefore } from "./replay/outline-from-facts.w0b";

type Outline = Pick<ReturnType<typeof outlineFromFacts>, "skeleton" | "outlineFactRefs">;
const TEACH = new Set(["content", "worked-example", "image-text"]);

function measure(facts: OutlineFacts, r: Outline, slideCount: number) {
  const outline = r.skeleton.outline;
  const refsAt = (i: number) => r.outlineFactRefs.find((e) => e.index === i)?.factRefs ?? [];
  const exit = outline.length - 1;
  const starterAt = outline.findIndex((e) => e.kind === "starter");
  const objectivesOf = (i: number) => outline[i]?.factRefs.map((f) => f.index) ?? [];
  const teachAt = outline.flatMap((e, i) => (TEACH.has(e.kind) ? [i] : []));
  const practiseAt = outline.flatMap((e, i) => (e.phase === "practise" ? [i] : []));
  const objectives = new Set(teachAt.flatMap(objectivesOf));
  let inCycle = 0;
  for (const o of objectives) {
    const last = Math.max(...teachAt.filter((i) => objectivesOf(i).includes(o)));
    const nextTeach = teachAt.find((i) => i > last && !objectivesOf(i).includes(o)) ?? exit;
    if (practiseAt.some((i) => i > last && i < nextTeach && objectivesOf(i).includes(o))) {
      inCycle += 1;
    }
  }
  const lastTeach = Math.max(-1, ...teachAt);
  const mid = practiseAt.filter((i) => i < lastTeach).length;
  const examples = outline.flatMap((e, i) => (e.kind === "worked-example" ? [i] : []));
  const modelFirst = examples.filter((x) =>
    practiseAt
      .filter((i) => objectivesOf(i).some((o) => objectivesOf(x).includes(o)))
      .every((i) => i > x),
  ).length;
  const keyIdeaAt = new Map<number, number>();
  outline.forEach((_, i) => {
    for (const f of refsAt(i)) {
      if (f.type === "keyIdea" && !keyIdeaAt.has(f.index)) keyIdeaAt.set(f.index, i);
    }
  });
  let untaught = 0;
  outline.forEach((e, i) => {
    if (e.kind === "starter") return;
    for (const f of refsAt(i)) {
      if (f.type !== "question") continue;
      const named = (facts.questions[f.index]?.objectiveRefs ?? []).map((o) => o.index);
      const ideas = facts.keyIdeas.flatMap((k, j) =>
        k.objectiveRefs.some((o) => named.includes(o.index)) ? [j] : [],
      );
      const before = i === exit ? Infinity : i;
      if (ideas.some((k) => (keyIdeaAt.get(k) ?? Infinity) >= before)) untaught += 1;
    }
  });
  return {
    starter: starterAt >= 2 && starterAt <= 4,
    retrieval: starterAt >= 0 && /^Retrieval/.test(outline[starterAt]?.brief?.adds ?? ""),
    inCycle,
    taught: objectives.size,
    unpractised: [...objectives].filter((o) => !practiseAt.some((i) => objectivesOf(i).includes(o)))
      .length,
    mid,
    practise: practiseAt.length,
    practiseQuestions: practiseAt.reduce(
      (n, i) => n + refsAt(i).filter((f) => f.type === "question").length,
      0,
    ),
    modelFirst,
    examples: examples.length,
    untaught,
    exit: refsAt(exit).filter((f) => f.type === "question").length,
    count: outline.length === slideCount,
    kinds: outline
      .slice(2)
      .map((e) => (e.kind === "exit-ticket" ? "exit" : e.kind.slice(0, 4)))
      .join(" "),
  };
}

type NumKey =
  | "inCycle"
  | "taught"
  | "unpractised"
  | "mid"
  | "practise"
  | "practiseQuestions"
  | "modelFirst"
  | "examples"
  | "untaught"
  | "exit";

async function main() {
  const md = process.argv.includes("--md");
  const runs = (await readdir(LAB_RESULTS))
    .filter((d) => /^w0b-.*-L-\d+$/.test(d) || /^np1.*-ff$/.test(d))
    .sort();
  type M = ReturnType<typeof measure>;
  const rows: { run: string; b: M; a: M; gaps: string[] }[] = [];
  for (const run of runs) {
    const saved = await loadRunFacts(run);
    const lesson = JSON.parse(await Bun.file(`${saved.dir}/lesson.json`).text()) as Lesson;
    if (!lesson.brief) continue;
    const input: OutlineFromFactsInput = {
      topic: lesson.brief.topic,
      objectives: saved.objectives.map((o) => ({ text: o.text })),
      facts: saved.facts,
      shape: shapeOf(lesson),
      slideCount: lesson.brief.slideCount ?? 10,
      priorKnowledge: lesson.brief.classContext?.priorKnowledge,
    };
    const before = outlineBefore(input);
    const after = outlineFromFacts(input);
    rows.push({
      run,
      b: measure(saved.facts, before, input.slideCount),
      a: measure(saved.facts, after, input.slideCount),
      gaps: after.gaps.filter((g) => !before.gaps.includes(g)),
    });
  }
  const L: string[] = [];
  L.push(
    "| run | starter | in-cycle | mid checks | practise | model-first | untaught-tested | exit | after kinds |",
    "|---|---|---|---|---|---|---|---|---|",
  );
  for (const { run, b, a } of rows) {
    const s = (m: M) => (m.starter ? (m.retrieval ? "R" : "y") : "-");
    L.push(
      `| ${run} | ${s(b)}→${s(a)} | ${b.inCycle}/${b.taught}→${a.inCycle}/${a.taught} | ${b.mid}→${a.mid} | ${b.practise}→${a.practise} (q ${b.practiseQuestions}→${a.practiseQuestions}) | ${b.modelFirst}/${b.examples}→${a.modelFirst}/${a.examples} | ${b.untaught}→${a.untaught} | ${b.exit}→${a.exit} | ${a.kinds} |`,
    );
  }
  for (const group of [
    { name: "w0b L", test: (r: string) => r.startsWith("w0b") },
    { name: "np1 -ff", test: (r: string) => r.startsWith("np1") },
    { name: "all", test: () => true },
  ]) {
    const kept = rows.filter((r) => group.test(r.run));
    const sum = (side: "b" | "a", key: NumKey) => kept.reduce((n, r) => n + r[side][key], 0);
    const count = (side: "b" | "a", key: "starter" | "retrieval" | "count") =>
      kept.filter((r) => r[side][key]).length;
    const pair = (key: NumKey) => `${sum("b", key)}→${sum("a", key)}`;
    L.push(
      `| **${group.name} (${kept.length})** | ${count("b", "starter")} (R ${count("b", "retrieval")})→${count("a", "starter")} (R ${count("a", "retrieval")}) | ${sum("b", "inCycle")}/${sum("b", "taught")}→${sum("a", "inCycle")}/${sum("a", "taught")} | ${pair("mid")} (unpractised ${pair("unpractised")}) | ${pair("practise")} (q ${pair("practiseQuestions")}) | ${sum("b", "modelFirst")}/${sum("b", "examples")}→${sum("a", "modelFirst")}/${sum("a", "examples")} | ${pair("untaught")} | ${pair("exit")} | exact count ${count("b", "count")}→${count("a", "count")} |`,
    );
  }
  const newGaps = new Map<string, number>();
  for (const r of rows) {
    for (const g of r.gaps) {
      const key = g.replace(/about .+ instead/, "about <topic> instead").replace(/\d+/g, "N");
      newGaps.set(key, (newGaps.get(key) ?? 0) + 1);
    }
  }
  L.push("", "New gaps (after, not before), by pattern:");
  for (const [g, n] of [...newGaps].sort((x, y) => y[1] - x[1])) L.push(`- ${n}× ${g}`);
  console.log(md ? L.join("\n") : L.join("\n"));
}

await main();
