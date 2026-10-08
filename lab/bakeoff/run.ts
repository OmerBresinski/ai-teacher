// BAKEOFF runner: one arm on one or more briefs -> BAKEOFF/runs/<arm>/<brief>/ (lesson, render, timings, cost, log).
// Usage: bun lab/bakeoff/run.ts --arm T --cap 0.25 [--pg 5616] [--out <runsDir>] [--replay <main.txt>]
//        [--no-visuals] [--no-notes] [--no-repair] [--no-render] <brief-id> [...]
// Keys are read from ~/.dayback-openai-key and ~/.dayback-pexels-key (never printed).
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import {
  useJudgeImage,
  useJudgeVersion,
  usePhotoGate,
} from "../../packages/generation/src/stages/illustrate";
import { useDirectorVersion } from "../../packages/generation/src/stages/picture-director";
import { embedCostUsd, imageCostUsd } from "../../packages/images/src/index";
import { setParticleLabelMend } from "../../packages/slides/src/diagrams/labels3";
import {
  onLabelDrop,
  setDiagramParts,
  setDiagramPolish,
} from "../../packages/slides/src/diagrams/polish";
import { setPlotZone } from "../../packages/slides/src/templates/index";
import {
  abLabels3,
  abPlotZone,
  abPolish,
  abPolish2,
  abSnugNodes,
  isAbArm,
  pictureVersions,
  pinFaults,
  setAbArm,
  setAbCodeArm,
} from "./ab/arms";
import { createCache, loadRun, loadStore, type ReqForm, seedStore, summary } from "./ab/cache";
import { legacyImporter } from "./ab/cache-import";
import { lessonDone, moveToCrashed } from "./ab/done";
import { photoGate } from "./ab/polish";
import { armT } from "./arm-t";
import { type ArmPlugin, type Brief, runLesson } from "./harness";
import { renderLesson } from "./render";
import { BAKEOFF, PRICES, type Usage, usd } from "./services";

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
  "--code-arm",
]);
// Response cache (ab/CACHE.md): `--replay <runDir>` (a directory) replays that run's recorded calls
// (or imports an older run's logs); a file is still a recorded writer stream (`--replay <main.txt>`).
const replayArg = opt("--replay");
const replayDir = replayArg && statSync(replayArg).isDirectory() ? replayArg : undefined;
const streamReplay = replayDir ? undefined : replayArg;
const briefs = args.filter((a, i) => !a.startsWith("--") && !VALUED.has(args[i - 1] ?? ""));
// A/B (7 Oct): `--arm base|a1|a2|a3` runs arm T with that A/B arm's pinned writer prompt and schema.
const armArg = opt("--arm", "T") as string;
if (isAbArm(armArg)) setAbArm(armArg);
// Cache: `--code-arm <arm>` runs that arm's code switches on this arm's prompts (a code-only A/B).
const codeArmArg = opt("--code-arm");
if (codeArmArg) {
  if (!isAbArm(codeArmArg)) throw new Error(`--code-arm ${codeArmArg} is not an A/B arm`);
  setAbCodeArm(codeArmArg);
}
// Round 6: the arm's picture judge (judge20 = v20; every other arm v17).
useJudgeVersion(pictureVersions(isAbArm(armArg) ? armArg : undefined).judge);
// Round 6: the arm's picture director (dir-stage and y1fix = v12; every other arm v11).
useDirectorVersion(pictureVersions(isAbArm(armArg) ? armArg : undefined).director);
// polish arm (rootcause/uk-seasons.md): renderer fixes, 768 px judge input and the photo gate.
if (abPolish2()) {
  // polish2 (D30): base4's judge input; the colour gate and label drops only log.
  const say = (e: object) => console.error(JSON.stringify({ t: Date.now(), ...e }));
  setDiagramPolish(true, "label");
  onLabelDrop((e) => say({ ev: "label-dropped", ...e }));
  usePhotoGate(photoGate(say, false));
} else if (abPolish()) {
  setDiagramPolish(true);
  useJudgeImage(768);
  usePhotoGate(photoGate((e) => console.error(JSON.stringify({ t: Date.now(), ...e }))));
} else if (abSnugNodes()) {
  // base6: only the snug filled nodes; base4's judge input, no photo gate, no gap gate, no strips.
  setDiagramParts({ nodes: true });
}
// plotzone (chalkie fix 3b): independent of the polish parts above; off for every other arm.
if (abPlotZone()) setPlotZone(true);
// labels3 (faults-3-6-8 #3): the particles label mend, on its own.
if (abLabels3()) setParticleLabelMend(true);
const arm = ARMS[isAbArm(armArg) ? "T" : armArg];
if (!arm) throw new Error(`no arm ${opt("--arm")}; have ${Object.keys(ARMS).join(", ")}`);
const cap = Number(opt("--cap", "0.25"));
// A/B: a paid run only on the pinned prompt and schema files (ab/check.ts --pin wrote PINS.json).
if (isAbArm(armArg) && cap > 0 && !streamReplay && !flag("--offline")) {
  const bad = pinFaults(armArg);
  if (bad.length) {
    console.error(`A/B arm ${armArg}: refusing a paid run:\n  ${bad.join("\n  ")}`);
    process.exit(3);
  }
}
const runs = opt("--out", `${BAKEOFF}/runs`) as string;
const realFetch = globalThis.fetch;
/** A fresh call's cost from its request and reported usage (cache records; spend is booked as before). */
function callUsd(f: ReqForm, u0: unknown): number {
  const u = (u0 ?? {}) as Record<string, number & Record<string, number>>;
  const j = (f.body as { json?: { model?: string } } | null)?.json;
  const model = String(j?.model ?? "").replace(/^openai\//, "");
  if (/\/chat\/completions|\/responses/.test(f.url) && PRICES[model])
    return usd(model, {
      prompt_tokens: u.prompt_tokens ?? u.input_tokens ?? 0,
      completion_tokens: u.completion_tokens ?? u.output_tokens ?? 0,
      prompt_tokens_details: {
        cached_tokens: (u.prompt_tokens_details ?? u.input_tokens_details)?.cached_tokens ?? 0,
      },
    } as Usage);
  if (/\/images\//.test(f.url))
    return imageCostUsd({
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      imageInputTokens: u.input_tokens_details?.image_tokens ?? 0,
    });
  if (/\/embeddings/.test(f.url)) return embedCostUsd(u.total_tokens ?? 0);
  return 0;
}
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
  // Audit F6: only a finished lesson (summary event) is skipped; an unfinished one is moved aside.
  if (lessonDone(outDir)) {
    console.log(`SKIP ${id}: ${outDir} is finished (use a fresh --out)`);
    continue;
  }
  if (existsSync(outDir))
    console.log(`${id}: unfinished ${outDir} moved to ${moveToCrashed(outDir)}`);
  // Reads come only from the replayed run (or the whole store with --cache-any): a run without
  // --replay calls fresh, and a changed request never matches a recorded key, so it is called fresh.
  const src = replayDir
    ? [`${replayDir}/T/${id}`, `${replayDir}/${id}`, replayDir].find(
        (d) => existsSync(`${d}/calls.jsonl`) || existsSync(`${d}/request.json`),
      )
    : undefined;
  const noCache = flag("--no-cache");
  const fromRun = src && !noCache ? loadRun(src) : undefined;
  if (src && fromRun) seedStore(src);
  const policy = noCache
    ? "fresh (--no-cache)"
    : flag("--cache-any")
      ? "any stored response (--cache-any)"
      : src
        ? `replay ${src}${fromRun ? "" : " (imported from its logs)"}`
        : "fresh (no --replay)";
  const cache = createCache(
    {
      runDir: outDir,
      source: noCache ? undefined : flag("--cache-any") ? loadStore(undefined) : fromRun,
      sourceBlobs: src ? [`${src}/calls/blobs`] : [],
      offline: flag("--offline"),
      importers: src && !noCache && !fromRun ? [legacyImporter(src)] : [],
      price: callUsd,
    },
    realFetch,
  );
  globalThis.fetch = cache.fetch;
  const r = await runLesson({
    arm,
    brief,
    outDir,
    capUsd: cap,
    pgPort: Number(opt("--pg", "5616")),
    replay: streamReplay,
    noVisuals: flag("--no-visuals"),
    ...(opt("--reuse-visuals") ? { reuseVisuals: opt("--reuse-visuals") } : {}),
    // exit1 code-only replay (ab/arms3/exit1/DIFF.md): recorded writers have no exit_ticket field.
    ...(flag("--exit-fixture")
      ? {
          exitFixture: {
            questions: ["Fixture question 1?", "Fixture question 2?", "Fixture question 3?"],
          },
        }
      : {}),
    ...(flag("--exit-on-slides") ? { exitOnSlides: true } : {}),
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
  }).catch(async (e) => {
    // Audit F6: a crashed or refused lesson leaves <arm>/ for crashed/, with its cache summary.
    await cache.drain();
    globalThis.fetch = realFetch;
    if (existsSync(outDir)) {
      const cs = summary(cache.stats, policy, "lesson did not finish");
      appendFileSync(`${outDir}/log.jsonl`, `${JSON.stringify(cs)}\n`);
      writeFileSync(`${outDir}/cache.json`, JSON.stringify(cs, null, 1));
      console.log(id, "did not finish:", String(e).slice(0, 200), "->", moveToCrashed(outDir));
    }
    throw e;
  });
  await cache.drain();
  globalThis.fetch = realFetch;
  const cs = summary(
    cache.stats,
    policy,
    src && !noCache
      ? "requests unchanged vs the replayed run are served from it at $0; changed ones are called fresh"
      : "every call fresh (recorded for later replays)",
  );
  appendFileSync(`${outDir}/log.jsonl`, `${JSON.stringify(cs)}\n`);
  writeFileSync(`${outDir}/cache.json`, JSON.stringify(cs, null, 1));
  console.log(id, "cache", JSON.stringify({ ...cs, byStage: undefined }));
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
