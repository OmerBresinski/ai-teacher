// BAKEOFF runner: one arm on one or more briefs -> BAKEOFF/runs/<arm>/<brief>/ (lesson, render, timings, cost, log).
// Usage: bun lab/bakeoff/run.ts --arm T --cap 0.25 [--pg 5616] [--out <runsDir>] [--replay <main.txt>]
//        [--no-visuals] [--no-notes] [--no-repair] [--no-render] <brief-id> [...]
// Keys are read from ~/.dayback-openai-key and ~/.dayback-pexels-key (never printed).
import { existsSync, readFileSync } from "node:fs";
import {
  useJudgeImage,
  useJudgeVersion,
  usePhotoGate,
} from "../../packages/generation/src/stages/illustrate";
import { useDirectorVersion } from "../../packages/generation/src/stages/picture-director";
import { setDiagramPolish } from "../../packages/slides/src/diagrams/polish";
import { abPolish, isAbArm, pictureVersions, pinFaults, setAbArm } from "./ab/arms";
import { photoGate } from "./ab/polish";
import { armT } from "./arm-t";
import { type ArmPlugin, type Brief, runLesson } from "./harness";
import { renderLesson } from "./render";
import { BAKEOFF } from "./services";

/** Arms register here; K and R add theirs on their branches. */
export const ARMS: Record<string, ArmPlugin> = { T: armT };

const args = process.argv.slice(2);
const flag = (k: string) => args.includes(k);
const opt = (k: string, d?: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const VALUED = new Set([
  "--arm",
  "--cap",
  "--pg",
  "--out",
  "--replay",
  "--bank-cap",
  "--reuse-visuals",
  "--fresh-slides",
  "--generic",
  "--budget-dir",
  "--replay-repair",
  "--challenge",
  "--objectives-from",
]);
const briefs = args.filter((a, i) => !a.startsWith("--") && !VALUED.has(args[i - 1] ?? ""));
// A/B (7 Oct): `--arm base|a1|a2|a3` runs arm T with that A/B arm's pinned writer prompt and schema.
const armArg = opt("--arm", "T") as string;
if (isAbArm(armArg)) setAbArm(armArg);
// Round 6: the arm's picture judge (judge20 = v20; every other arm v17).
useJudgeVersion(pictureVersions(isAbArm(armArg) ? armArg : undefined).judge);
// Round 6: the arm's picture director (dir-stage and y1fix = v12; every other arm v11).
useDirectorVersion(pictureVersions(isAbArm(armArg) ? armArg : undefined).director);
// polish arm (rootcause/uk-seasons.md): renderer fixes, 768 px judge input and the photo gate.
if (abPolish()) {
  setDiagramPolish(true);
  useJudgeImage(768);
  usePhotoGate(photoGate((e) => console.error(JSON.stringify({ t: Date.now(), ...e }))));
}
const arm = ARMS[isAbArm(armArg) ? "T" : armArg];
if (!arm) throw new Error(`no arm ${opt("--arm")}; have ${Object.keys(ARMS).join(", ")}`);
const cap = Number(opt("--cap", "0.25"));
// A/B: a paid run only on the pinned prompt and schema files (ab/check.ts --pin wrote PINS.json).
if (isAbArm(armArg) && cap > 0 && !opt("--replay")) {
  const bad = pinFaults(armArg);
  if (bad.length) {
    console.error(`A/B arm ${armArg}: refusing a paid run:\n  ${bad.join("\n  ")}`);
    process.exit(3);
  }
}
const runs = opt("--out", `${BAKEOFF}/runs`) as string;
for (const id of briefs) {
  const bf = `${BAKEOFF}/briefs/${id}.json`;
  if (!existsSync(bf)) throw new Error(`no brief ${bf}`);
  const brief = JSON.parse(readFileSync(bf, "utf8")) as Brief;
  // Round 4 test override (HARNESS "challenge input"): --challenge or CHALLENGE; the run folder
  // gets the value as a suffix so the three y11 lessons sit side by side.
  const challenge = (opt("--challenge") as string | undefined) ?? process.env.CHALLENGE;
  if (challenge && !["support", "core", "stretch"].includes(challenge))
    throw new Error(`--challenge must be support, core or stretch, not ${challenge}`);
  if (challenge) brief.challenge = challenge as Brief["challenge"];
  const outDir = `${runs}/${arm.id}/${id}${challenge ? `.${challenge}` : ""}`;
  if (existsSync(`${outDir}/lesson.json`)) {
    console.log(`SKIP ${id}: ${outDir} exists (use a fresh --out)`);
    continue;
  }
  const r = await runLesson({
    arm,
    brief,
    outDir,
    capUsd: cap,
    pgPort: Number(opt("--pg", "5616")),
    replay: opt("--replay"),
    noVisuals: flag("--no-visuals"),
    ...(opt("--reuse-visuals") ? { reuseVisuals: opt("--reuse-visuals") } : {}),
    ...(opt("--generic") === "generate" ? { generic: "generate" as const } : {}),
    ...(flag("--no-library") ? { noLibrary: true } : {}),
    ...(opt("--budget-dir") ? { budgetDir: String(opt("--budget-dir")) } : {}),
    ...(opt("--fresh-slides")
      ? { freshSlides: String(opt("--fresh-slides")).split(",").map(Number) }
      : {}),
    noNotes: flag("--no-notes"),
    writerOnly: flag("--writer-only"),
    ...(opt("--objectives-from") ? { objectivesFrom: String(opt("--objectives-from")) } : {}),
    noRepair: flag("--no-repair"),
    ...(opt("--replay-repair") ? { replayRepair: opt("--replay-repair") } : {}),
    modelTheme: flag("--model-theme"),
    ...(opt("--bank-cap") ? { bankCapUsd: Number(opt("--bank-cap")) } : {}),
  });
  console.log(
    id,
    JSON.stringify({
      timings: r.timings,
      cost: r.cost,
      failing: r.checks.filter((c) => c.faults.length).length,
    }),
  );
  if (!flag("--no-render") && !flag("--writer-only"))
    console.log("rendered", await renderLesson(r.lessonFile));
}
process.exit(0);
