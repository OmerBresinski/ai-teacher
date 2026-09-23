#!/usr/bin/env bun
// bun packages/generation/eval/replay-outline.ts [--glob np1] [--md]
//
// Replays the outline step over saved lab runs, no model calls: each `eval/results/lab/<glob>*/`
// run's `lesson.json` facts (ids turned back into ordinal refs) through the outline step as it was
// before the np1 RC1 fix (`eval/replay/outline-from-facts.before.ts`) and as it is now
// (`src/outline-from-facts.ts`), with the brief's shape and slide count. Per run: content slides,
// key ideas unplaced, questions on practise or exit slides whose objective has an unplaced key idea
// ("untaught-tested"), gaps; plus the lab checks `key-idea-not-taught` and
// `question-on-untaught-key-idea` on the saved deck (before) and on the new outline (after).
// `fidelity` says whether the OLD replay rebuilds the saved outline's kinds: the saved facts drop
// the questions' `forms` and `demand`, so a question's slide form can differ.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Lesson } from "@tj/domain/documents";
import {
  type OutlineFacts,
  type OutlineFromFactsResult,
  outlineFromFacts,
} from "../src/outline-from-facts";
import { assignFactIds } from "../src/specs";
import { shapeOf } from "../src/stages/shared";
import { toOutlineFacts } from "./from-facts";
import { labChecks } from "./lab";
import { outlineFromFacts as outlineBefore } from "./replay/outline-from-facts.before";

const ROOT = join(import.meta.dir, "results", "lab");
const PITCH = { readingAgeTarget: 10, sentenceLengthMax: 16, avoid: [] };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

type Row = {
  run: string;
  fidelity: string;
  keyIdeas: number;
  contentBefore: number;
  contentAfter: number;
  unplacedBefore: number;
  unplacedAfter: number;
  untaughtTestedBefore: number;
  untaughtTestedAfter: number;
  exitBefore: number;
  exitAfter: number;
  gapsBefore: number;
  gapsAfter: number;
  labBefore: string;
  labAfter: string;
  kindsAfter: string;
  newGaps: string[];
};

/** Questions on practise or exit slides whose objective has a key idea no content slide carries. */
function measure(facts: OutlineFacts, r: OutlineFromFactsResult) {
  const placed = new Set(
    r.outlineFactRefs.flatMap((e) =>
      e.factRefs.filter((f) => f.type === "keyIdea").map((f) => f.index),
    ),
  );
  const untaught = new Set(
    facts.keyIdeas.flatMap((k, i) => (placed.has(i) ? [] : k.objectiveRefs.map((o) => o.index))),
  );
  const questions = r.outlineFactRefs.flatMap((e) =>
    r.skeleton.outline[e.index]?.phase === "starter"
      ? []
      : e.factRefs.filter((f) => f.type === "question").map((f) => f.index),
  );
  const exitEntry = r.outlineFactRefs.find((e) => e.index === r.skeleton.outline.length - 1);
  return {
    content: r.skeleton.outline.filter((e) => e.kind === "content").length,
    unplaced: facts.keyIdeas.length - placed.size,
    untaughtTested: questions.filter((i) =>
      (facts.questions[i]?.objectiveRefs ?? []).some((o) => untaught.has(o.index)),
    ).length,
    exit: exitEntry?.factRefs.filter((f) => f.type === "question").length ?? 0,
  };
}

/** The outline's kinds with every practise question form read as one (`q`). */
const asked = (kinds: string) =>
  kinds.replace(/multiple-choice|open-response|true-false|instructions|discussion/g, "q");

function labCounts(lesson: Lesson): string {
  const findings = labChecks(lesson);
  const n = (check: string) => findings.filter((f) => f.check === check).length;
  return `${n("key-idea-not-taught")}/${n("question-on-untaught-key-idea")}`;
}

async function main() {
  const glob = arg("glob") ?? "np1";
  // A `--from-facts` rerun (`<run>-ff`) reuses its original's facts: not a run of its own here.
  const runs = (await readdir(ROOT)).filter((d) => d.startsWith(glob) && !d.endsWith("-ff")).sort();
  const rows: Row[] = [];
  const skipped: string[] = [];
  for (const run of runs) {
    let lesson: Lesson;
    try {
      lesson = JSON.parse(await readFile(join(ROOT, run, "lesson.json"), "utf8")) as Lesson;
    } catch {
      skipped.push(`${run} (no lesson.json)`);
      continue;
    }
    const saved = lesson.facts;
    if (!saved || !lesson.brief) {
      skipped.push(`${run} (no facts)`);
      continue;
    }
    const facts = toOutlineFacts(saved);
    const input = {
      topic: lesson.brief.topic,
      objectives: saved.objectives.map((o) => ({ text: o.text })),
      facts,
      shape: shapeOf(lesson),
      slideCount: lesson.brief.slideCount ?? 10,
    } as Parameters<typeof outlineFromFacts>[0];
    const before = outlineBefore(input as never) as unknown as OutlineFromFactsResult;
    const after = outlineFromFacts(input);
    const savedKinds = saved.outline.map((e) => e.kind).join(",");
    const beforeKinds = before.skeleton.outline.map((e) => e.kind).join(",");
    const b = measure(facts, before);
    const a = measure(facts, after);
    const merged = assignFactIds(
      after.skeleton,
      { ...facts, outlineFactRefs: after.outlineFactRefs, pitch: PITCH } as never,
      saved.durationMin,
    );
    rows.push({
      run,
      fidelity:
        savedKinds === beforeKinds
          ? "same"
          : asked(savedKinds) === asked(beforeKinds)
            ? "question forms"
            : "differs",
      keyIdeas: facts.keyIdeas.length,
      contentBefore: b.content,
      contentAfter: a.content,
      unplacedBefore: b.unplaced,
      unplacedAfter: a.unplaced,
      untaughtTestedBefore: b.untaughtTested,
      untaughtTestedAfter: a.untaughtTested,
      exitBefore: b.exit,
      exitAfter: a.exit,
      gapsBefore: before.gaps.length,
      gapsAfter: after.gaps.length,
      labBefore: labCounts(lesson),
      labAfter: labCounts({ ...lesson, facts: merged, slides: [] }),
      kindsAfter: after.skeleton.outline
        .slice(2, -1)
        .map((e, i) =>
          e.kind === "content"
            ? `content[${
                after.outlineFactRefs
                  .find((x) => x.index === i + 2)
                  ?.factRefs.filter((f) => f.type === "keyIdea")
                  .map((f) => `k${f.index + 1}`)
                  .join("+") ?? ""
              }]`
            : e.kind,
        )
        .join(" "),
      newGaps: after.gaps.filter((g) => !before.gaps.includes(g)),
    });
  }

  const sum = (key: keyof Row) => rows.reduce((t, r) => t + Number(r[key]), 0);
  const L: string[] = [];
  L.push(
    "| run | fidelity | KI | content before→after | KI unplaced before→after | untaught-tested Qs before→after | exit Qs before→after | gaps before→after | lab KI-not-taught/Q-on-untaught saved deck→new |",
    "|---|---|---|---|---|---|---|---|---|",
  );
  for (const r of rows) {
    L.push(
      `| ${r.run} | ${r.fidelity} | ${r.keyIdeas} | ${r.contentBefore}→${r.contentAfter} | ${r.unplacedBefore}→${r.unplacedAfter} | ${r.untaughtTestedBefore}→${r.untaughtTestedAfter} | ${r.exitBefore}→${r.exitAfter} | ${r.gapsBefore}→${r.gapsAfter} | ${r.labBefore}→${r.labAfter} |`,
    );
  }
  L.push(
    `| **total (${rows.length} runs)** | ${rows.filter((r) => r.fidelity === "same").length} same | ${sum("keyIdeas")} | ${sum("contentBefore")}→${sum("contentAfter")} | ${sum("unplacedBefore")}→${sum("unplacedAfter")} | ${sum("untaughtTestedBefore")}→${sum("untaughtTestedAfter")} | ${sum("exitBefore")}→${sum("exitAfter")} | ${sum("gapsBefore")}→${sum("gapsAfter")} | |`,
  );
  L.push("", "New outlines (between objectives and exit ticket):");
  for (const r of rows) L.push(`- ${r.run}: ${r.kindsAfter}`);
  L.push("", "New gap sentences:");
  for (const r of rows) {
    for (const g of r.newGaps) L.push(`- ${r.run}: ${g}`);
  }
  if (skipped.length > 0) L.push("", `Skipped: ${skipped.join("; ")}`);
  console.log(L.join("\n"));
}

if (import.meta.main) await main();
