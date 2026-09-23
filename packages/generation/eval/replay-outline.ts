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
//
// `--w0` (w0 fixes, 24 Sep): the w0 lab runs (`w0-*-L-*`) and the np1 `-ff` runs, each through the
// outline at 48f3355 (`eval/replay/outline-from-facts.w0.ts`) and the current one, with the lost
// `forms` declarations SIMULATED as plan-facts-objective v12 writes them (facts-c-v9: three
// distractors → multiple-choice + open-response; a stem opening "True or false" → true-false +
// open-response; else open-response). Counts per run: MC-native stems planned on stem-only steps
// without their options, true/false exit lines, MC exit items set with options; and on the saved
// deck: the checkLesson referent errors it recorded, numeric mismatches, objectives-slide gaps and
// echoed distractors. The simulation reads stem text only to rebuild a lost declaration; the
// pipeline itself never does.

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
import { isMcNative, labChecks } from "./lab";
import { outlineFromFacts as outlineBefore } from "./replay/outline-from-facts.before";
import { outlineFromFacts as outlineW0 } from "./replay/outline-from-facts.w0";

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
  mcStemSaved: number;
  mcStemAfter: number;
  mcOptionsAfter: number;
  mc: ReturnType<typeof mcCounts>;
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

/** Lab `mc-stem-without-options` findings, and the option tells on the facts and on MC slides. */
function mcCounts(lesson: Lesson) {
  const findings = labChecks(lesson);
  const n = (check: string, slides: boolean) =>
    findings.filter((f) => f.check === check && (f.slide !== undefined) === slides).length;
  return {
    stem: findings.filter((f) => f.check === "mc-stem-without-options").length,
    withOptions: findings.filter((f) => f.check === "mc-options-on-stem-step").length,
    factsLongest: n("mc-tell-longest", false),
    factsPunct: n("mc-tell-punctuation", false),
    slidesLongest: n("mc-tell-longest", true),
    slidesPunct: n("mc-tell-punctuation", true),
    mcSlides: lesson.slides.filter((s) => s.question?.type === "multiple-choice").length,
    mcFacts: (lesson.facts?.questions ?? []).filter(isMcNative).length,
  };
}

type Sim = OutlineFacts["questions"][number] & { forms?: string[] };

/** The lost `forms` declarations, as v12 writes them (see the header). */
function simulateForms(facts: OutlineFacts): OutlineFacts {
  return {
    ...facts,
    questions: facts.questions.map((q): Sim => {
      const forms =
        (q.distractors?.length ?? 0) >= 3
          ? ["multiple-choice", "open-response"]
          : /^true or false/i.test(q.stem)
            ? ["true-false", "open-response"]
            : ["open-response"];
      return { ...q, forms } as Sim;
    }),
  } as OutlineFacts;
}

async function w0(): Promise<void> {
  const runs = (await readdir(ROOT))
    .filter((d) => /^w0-.*-L-\d+$/.test(d) || /^np1.*-ff$/.test(d))
    .sort();
  const L: string[] = [
    "| run | sim fidelity | MC stems w/o options: saved deck / planned before→after | true/false exit lines before→after | MC exit items with options before→after | referent errors (saved) | numeric (saved facts+deck) | objectives slide gaps (saved) | echoed distractors (saved) |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  const t = {
    saved: 0,
    mcB: 0,
    mcA: 0,
    tfB: 0,
    tfA: 0,
    optB: 0,
    optA: 0,
    ref: 0,
    num: 0,
    obj: 0,
    echo: 0,
    same: 0,
  };
  for (const run of runs) {
    let lesson: Lesson;
    let incomplete: string[] = [];
    try {
      lesson = JSON.parse(await readFile(join(ROOT, run, "lesson.json"), "utf8")) as Lesson;
      const result = JSON.parse(await readFile(join(ROOT, run, "result.json"), "utf8")) as {
        status?: { incomplete?: string[] };
      };
      incomplete = result.status?.incomplete ?? [];
    } catch {
      continue;
    }
    const saved = lesson.facts;
    if (!saved || !lesson.brief) continue;
    const facts = simulateForms(toOutlineFacts(saved));
    const input = {
      topic: lesson.brief.topic,
      objectives: saved.objectives.map((o) => ({ text: o.text })),
      facts,
      shape: shapeOf(lesson),
      slideCount: lesson.brief.slideCount ?? 10,
    } as Parameters<typeof outlineFromFacts>[0];
    const measureOf = (r: OutlineFromFactsResult) => {
      const merged = assignFactIds(
        r.skeleton,
        { ...facts, outlineFactRefs: r.outlineFactRefs, pitch: PITCH } as never,
        saved.durationMin,
      );
      const found = labChecks({ ...lesson, facts: merged, slides: [] });
      const exit = r.outlineFactRefs.find((e) => e.index === r.skeleton.outline.length - 1);
      return {
        kinds: r.skeleton.outline.map((e) => e.kind).join(","),
        mc: found.filter((f) => f.check === "mc-stem-without-options").length,
        opt: found.filter((f) => f.check === "mc-options-on-stem-step").length,
        tf: (exit?.factRefs ?? []).filter(
          (f) =>
            f.type === "question" &&
            ((facts.questions[f.index] as Sim | undefined)?.forms ?? []).includes("true-false"),
        ).length,
      };
    };
    const b = measureOf(outlineW0(input as never) as unknown as OutlineFromFactsResult);
    const a = measureOf(outlineFromFacts(input));
    const onDeck = labChecks(lesson);
    const n = (check: string) => onDeck.filter((f) => f.check === check).length;
    const row = {
      saved: n("mc-stem-without-options"),
      ref: incomplete.filter((m) => /no question posed/.test(m)).length,
      num: n("numeric-mismatch"),
      obj: n("objectives-slide-incomplete"),
      echo: n("distractor-equals-answer"),
    };
    const same = b.kinds === saved.outline.map((e) => e.kind).join(",");
    L.push(
      `| ${run} | ${same ? "same" : "differs"} | ${row.saved} / ${b.mc}→${a.mc} | ${b.tf}→${a.tf} | ${b.opt}→${a.opt} | ${row.ref} | ${row.num} | ${row.obj} | ${row.echo} |`,
    );
    t.saved += row.saved;
    t.mcB += b.mc;
    t.mcA += a.mc;
    t.tfB += b.tf;
    t.tfA += a.tf;
    t.optB += b.opt;
    t.optA += a.opt;
    t.ref += row.ref;
    t.num += row.num;
    t.obj += row.obj;
    t.echo += row.echo;
    t.same += same ? 1 : 0;
  }
  L.push(
    `| **total** | ${t.same} same | ${t.saved} / ${t.mcB}→${t.mcA} | ${t.tfB}→${t.tfA} | ${t.optB}→${t.optA} | ${t.ref} | ${t.num} | ${t.obj} | ${t.echo} |`,
  );
  console.log(L.join("\n"));
}

async function main() {
  if (process.argv.includes("--w0")) return w0();
  const glob = arg("glob") ?? "np1";
  // A `--from-facts` rerun (`<run>-ff`) reuses its original's facts: not a run of its own here.
  // `--originals`: only each brief's first run, not its `-ff`, `-ff2`, `-capped` or `-superseded` reruns.
  const originals = process.argv.includes("--originals");
  const runs = (await readdir(ROOT))
    .filter(
      (d) =>
        d.startsWith(glob) &&
        !d.endsWith("-ff") &&
        (!originals || !/-ff\d*(-|$)|-capped|-superseded/.test(d)),
    )
    .sort();
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
      mcStemSaved: mcCounts(lesson).stem,
      mcStemAfter: mcCounts({ ...lesson, facts: merged, slides: [] }).stem,
      mcOptionsAfter: mcCounts({ ...lesson, facts: merged, slides: [] }).withOptions,
      mc: mcCounts(lesson),
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
  L.push(
    "",
    "Multiple-choice-native stems on stem-only steps (exit ticket, instructions, open-response, discussion, starter), and option tells (code-only: correct option strictly longest; only one with terminal punctuation):",
    "",
    "| run | MC stems w/o options saved outline→new | exit items set with options (new) | MC-native facts | tells on facts longest/punct | MC slides | tells on saved MC slides longest/punct |",
    "|---|---|---|---|---|---|---|",
  );
  for (const r of rows) {
    L.push(
      `| ${r.run} | ${r.mcStemSaved}→${r.mcStemAfter} | ${r.mcOptionsAfter} | ${r.mc.mcFacts} | ${r.mc.factsLongest}/${r.mc.factsPunct} | ${r.mc.mcSlides} | ${r.mc.slidesLongest}/${r.mc.slidesPunct} |`,
    );
  }
  const mcSum = (key: keyof ReturnType<typeof mcCounts>) => rows.reduce((t, r) => t + r.mc[key], 0);
  L.push(
    `| **total (${rows.length} runs)** | ${sum("mcStemSaved")}→${sum("mcStemAfter")} | ${sum("mcOptionsAfter")} | ${mcSum("mcFacts")} | ${mcSum("factsLongest")}/${mcSum("factsPunct")} | ${mcSum("mcSlides")} | ${mcSum("slidesLongest")}/${mcSum("slidesPunct")} |`,
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
