#!/usr/bin/env bun
// bun packages/generation/eval/replay-r1.ts
//
// Lab r1 structure (24 Sep): replays the outline step over the saved facts of the cb and w0b lab
// runs (`cb-*-L`, `w0b-*-L-N`), no model calls, through the outline at 045687f
// (`eval/replay/outline-from-facts.r1.ts`, before) and the current one (after). Counts, all
// structural:
// - items: pupil items — starter (its question refs; a model-written starter counts 1), practise
//   (question refs; a true/false or discussion slide with none counts 1) and exit (before: 3, the
//   generate-slide schema's fixed count; after: the lines code prints, capped at 6).
// - mid: practise slides before the last teaching slide; in-cycle: taught objectives checked
//   inside their own cycle (as replay-flow; after: the exit quiz straight after the last cycle
//   counts as its check, the r1 design).
// - starter: R retrieves declared prior knowledge, Q is a question set, T asks what pupils think.
// - ans: the exit answers are shown on a slide (after: the coded exit quiz reveals them).
// - untaught: question refs (not the starter) testing a key idea of a named objective that is on no
//   earlier slide (the exit: on no slide). Must be 0.
import { readdir } from "node:fs/promises";
import type { Lesson } from "@tj/domain/documents";
import {
  type OutlineFacts,
  type OutlineFromFactsInput,
  outlineFromFacts,
} from "../src/outline-from-facts";
import { shapeOf } from "../src/stages/shared";
import { LAB_RESULTS, loadRunFacts } from "./from-facts";
import { outlineFromFacts as outlineBefore } from "./replay/outline-from-facts.r1";

type Outline = Pick<ReturnType<typeof outlineFromFacts>, "skeleton" | "outlineFactRefs">;
const TEACH = new Set(["content", "worked-example", "image-text"]);

function measure(facts: OutlineFacts, r: Outline, slideCount: number, after: boolean) {
  const outline = r.skeleton.outline;
  const refsAt = (i: number) => r.outlineFactRefs.find((e) => e.index === i)?.factRefs ?? [];
  const qs = (i: number) => refsAt(i).filter((f) => f.type === "question").length;
  const exit = outline.length - 1;
  const objectivesOf = (i: number) => outline[i]?.factRefs.map((f) => f.index) ?? [];
  const teachAt = outline.flatMap((e, i) => (TEACH.has(e.kind) ? [i] : []));
  const practiseAt = outline.flatMap((e, i) => (e.phase === "practise" ? [i] : []));
  const objectives = new Set(teachAt.flatMap(objectivesOf));
  let inCycle = 0;
  for (const o of objectives) {
    const last = Math.max(...teachAt.filter((i) => objectivesOf(i).includes(o)));
    const nextTeach = teachAt.find((i) => i > last && !objectivesOf(i).includes(o)) ?? exit;
    const exitChecks = nextTeach === exit && after && refsAt(exit).length > 0;
    if (
      exitChecks ||
      practiseAt.some((i) => i > last && i < nextTeach && objectivesOf(i).includes(o))
    )
      inCycle += 1;
  }
  const lastTeach = Math.max(-1, ...teachAt);
  const starterAt = outline.findIndex((e) => e.kind === "starter");
  const starterQs = starterAt < 0 ? 0 : qs(starterAt);
  const starter =
    starterAt < 0
      ? "-"
      : starterQs > 0
        ? "Q"
        : /^Retrieval/.test(outline[starterAt]?.brief?.adds ?? "")
          ? "R"
          : "T";
  const practiseItems = practiseAt.reduce((n, i) => n + Math.max(1, qs(i)), 0);
  const exitItems = after
    ? Math.min(6, refsAt(exit).filter((f) => f.type !== "objective").length)
    : 3;
  const keyIdeaAt = new Map<number, number>();
  outline.forEach((_, i) => {
    for (const f of refsAt(i))
      if (f.type === "keyIdea" && !keyIdeaAt.has(f.index)) keyIdeaAt.set(f.index, i);
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
    items: (starterAt < 0 ? 0 : Math.max(1, starterQs)) + practiseItems + exitItems,
    split: `${starterAt < 0 ? 0 : Math.max(1, starterQs)}+${practiseItems}+${exitItems}`,
    mid: practiseAt.filter((i) => i < lastTeach).length,
    inCycle,
    taught: objectives.size,
    starter,
    exit: exitItems,
    answers: after && exitItems > 0,
    untaught,
    count: outline.length === slideCount,
    kinds: outline
      .slice(2)
      .map((e) => (e.kind === "exit-ticket" ? "exit" : e.kind.slice(0, 4)))
      .join(" "),
  };
}

async function main() {
  const runs = (await readdir(LAB_RESULTS))
    .filter((d) => /^cb-.*-L$/.test(d) || /^w0b-.*-L-\d+$/.test(d))
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
      b: measure(saved.facts, before, input.slideCount, false),
      a: measure(saved.facts, after, input.slideCount, true),
      gaps: after.gaps.filter((g) => !before.gaps.includes(g)),
    });
  }
  const L: string[] = [
    "| run | pupil items (starter+practise+exit) | checks mid-lesson | in-cycle | starter | exit items | answers shown | tested-not-taught | after kinds |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  const yn = (b: boolean) => (b ? "y" : "n");
  for (const { run, b, a } of rows) {
    L.push(
      `| ${run} | ${b.items} (${b.split}) → ${a.items} (${a.split}) | ${b.mid}→${a.mid} | ${b.inCycle}/${b.taught}→${a.inCycle}/${a.taught} | ${b.starter}→${a.starter} | ${b.exit}→${a.exit} | ${yn(b.answers)}→${yn(a.answers)} | ${b.untaught}→${a.untaught} | ${a.kinds}${a.count ? "" : " (COUNT!)"} |`,
    );
  }
  for (const group of [
    { name: "cb L", test: (r: string) => r.startsWith("cb") },
    { name: "w0b L", test: (r: string) => r.startsWith("w0b") },
    { name: "all", test: () => true },
  ]) {
    const k = rows.filter((r) => group.test(r.run));
    const sum = (
      side: "b" | "a",
      key: "items" | "mid" | "inCycle" | "taught" | "exit" | "untaught",
    ) => k.reduce((n, r) => n + r[side][key], 0);
    const has = (side: "b" | "a", f: (m: M) => boolean) => k.filter((r) => f(r[side])).length;
    L.push(
      `| **${group.name} (${k.length})** | ${sum("b", "items")}→${sum("a", "items")} | ${sum("b", "mid")}→${sum("a", "mid")} | ${sum("b", "inCycle")}/${sum("b", "taught")}→${sum("a", "inCycle")}/${sum("a", "taught")} | ${has("b", (m) => m.starter !== "-")}→${has("a", (m) => m.starter !== "-")} | ${sum("b", "exit")}→${sum("a", "exit")} | ${has("b", (m) => m.answers)}→${has("a", (m) => m.answers)} | ${sum("b", "untaught")}→${sum("a", "untaught")} | exact count ${has("b", (m) => m.count)}→${has("a", (m) => m.count)} |`,
    );
  }
  const newGaps = new Map<string, number>();
  for (const r of rows)
    for (const g of r.gaps) {
      const key = g.replace(/about .+ (before|instead)/, "about <topic> $1").replace(/\d+/g, "N");
      newGaps.set(key, (newGaps.get(key) ?? 0) + 1);
    }
  L.push("", "New gaps (after, not before), by pattern:");
  for (const [g, n] of [...newGaps].sort((x, y) => y[1] - x[1])) L.push(`- ${n}× ${g}`);
  console.log(L.join("\n"));
}

await main();
