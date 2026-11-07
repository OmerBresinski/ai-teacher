import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { pictureDirectorPrompt } from "../prompts/picture-director";
import { PICTURE_DIRECTOR_BATCH_SYSTEM } from "../prompts/picture-director-batch";
import { writerBrief } from "../stages/write";
import { sampleBriefLesson } from "../testing";
import { WRITER_BUNDLE_ID, WRITER_BUNDLES } from "./bundle";
import { PILOT_PACK_LIVE, PILOT_PACK_REVERT, type PilotPackId } from "./pilot-pack";
import {
  type BudgetStep,
  checkAppendOnly,
  checkCounts,
  checkHistory,
  type PromptBudget,
} from "./prompt-budget";
import type { WriterReq, WriterServices } from "./services";
import { runWriter } from "./stage";

/*
 * The prompt budget (prompt-budget.ts says what and why). Each writer text is measured on the real
 * request path: runWriter for one lesson per key stage, library models on and off, stopping at the
 * writer call, so every code-built slot (layout menu lines, Fits, diagram kinds, the Models list,
 * the wave-C lines) is counted as sent. To change a ceiling, append a step to that entry's history
 * in prompt-budget.json; the failure message prints the step to append.
 */
const FILE = "packages/generation/src/writer/prompt-budget.json";
const budget: PromptBudget = JSON.parse(
  readFileSync(new URL("prompt-budget.json", import.meta.url), "utf8"),
);

// The packs whose writer text is budgeted: v5.0a, whichever pack is live, and the revert pack.
const PACKS = [...new Set<PilotPackId>(["v5.0a", PILOT_PACK_LIVE, PILOT_PACK_REVERT])];
const LESSONS = [
  {
    ks: "KS1",
    yearGroup: "Year 2",
    ageBand: "ks1",
    subject: "History",
    obj: "Say where and when the Great Fire of London began.",
  },
  {
    ks: "KS2",
    yearGroup: "Year 4",
    ageBand: "ks2",
    subject: "History",
    obj: "Explain why the Romans built Hadrian's Wall.",
  },
  {
    ks: "KS3",
    yearGroup: "Year 8",
    ageBand: "ks3",
    subject: "Science",
    obj: "Describe how plants make glucose by photosynthesis.",
  },
] as const;

async function writerRequest(
  pack: PilotPackId,
  l: (typeof LESSONS)[number],
  library: boolean,
): Promise<WriterReq> {
  let got: WriterReq | undefined;
  const services = {
    log: () => {},
    chat: async () => {
      throw new Error("no chat in this test");
    },
    writer: async (r: WriterReq) => {
      got = r;
      throw new Error("stop after the request");
    },
  } as unknown as WriterServices;
  const lesson = sampleBriefLesson({
    yearGroup: l.yearGroup,
    ageBand: l.ageBand,
    subject: l.subject,
  } as never);
  let thrown: unknown;
  await runWriter({
    brief: writerBrief(lesson),
    objectives: [l.obj],
    services,
    pilotPack: pack,
    drawDiagrams: { callDrawer: async () => ({ out: undefined, usd: 0, ms: 0 }) },
    library,
    libraryMenuFilter: true,
    libraryMenuRank: true,
    libraryModelBody: true,
    libraryPanelsOff: true,
    checks: "log",
  } as never).catch((e) => {
    thrown = e;
  });
  if (!got) throw new Error(`no writer request: ${String((thrown as Error)?.message ?? thrown)}`);
  return got;
}

async function measure(): Promise<Record<string, number>> {
  const m: Record<string, number> = {};
  for (const pack of PACKS)
    for (const l of LESSONS)
      for (const library of [false, true]) {
        const r = await writerRequest(pack, l, library);
        const at = `writer/${pack}/${l.ks}/library-${library ? "on" : "off"}`;
        m[`${at}/system`] = r.system.length;
        m[`${at}/user`] = r.user.length;
        m[`${at}/schema`] = JSON.stringify(r.schema).length;
      }
  // The writer bundle's other calls (stage.ts: notes, repair, restage, pupil objectives). The
  // user texts are templates: code fills them per slide, so only the template is budgeted.
  const P = WRITER_BUNDLES[WRITER_BUNDLE_ID];
  for (const k of [
    "notes",
    "notesUser",
    "notesSchema",
    "repair",
    "restage",
    "repairUser",
    "pupilObjectives",
    "pupilObjectivesUser",
  ] as const)
    m[`bundle/${k}`] = P[k].length;
  const director = pictureDirectorPrompt({
    yearGroup: "Year 4",
    subject: "History",
    title: "t",
    country: "England",
    heading: "h",
    text: "",
    point: "",
    request: "r",
    mustShow: [],
    aspect: 1,
  });
  m["picture-director/system"] = director.system.length;
  m["picture-director-batch/system"] = PICTURE_DIRECTOR_BATCH_SYSTEM.length;
  return m;
}

/** prompt-budget.json as it is on the base: master's merge base locally, the parent commit in CI. */
function baseBudget(): PromptBudget | "no-base" | "no-file" {
  const git = (...a: string[]) => Bun.spawnSync(["git", ...a], { cwd: import.meta.dir });
  let ref = "HEAD^1";
  if (!process.env.CI) {
    const mb = git("merge-base", "HEAD", "origin/master");
    if (mb.exitCode !== 0) return "no-base";
    ref = mb.stdout.toString().trim();
  } else if (git("rev-parse", "--verify", "--quiet", "HEAD^1").exitCode !== 0) return "no-base";
  const shown = git("show", `${ref}:${FILE}`);
  return shown.exitCode === 0 ? JSON.parse(shown.stdout.toString()) : "no-file";
}

const steps = (s: Record<string, BudgetStep>) =>
  Object.entries(s)
    .map(([id, step]) => `  "${id}": append ${JSON.stringify(step)}`)
    .join("\n");

describe("prompt budget", () => {
  test("the budget file keeps its rules (dated, reasoned, raises referenced)", () => {
    expect(checkHistory(budget)).toEqual([]);
  });

  test("history is append-only against the base", () => {
    const base = baseBudget();
    // CI checks out with fetch-depth 2, so the parent is there; without it the check cannot run.
    if (base === "no-base") {
      expect(process.env.CI ?? "", "CI needs fetch-depth: 2 for this check").toBe("");
      return;
    }
    if (base === "no-file") return; // the commit that adds the budget
    expect(checkAppendOnly(base, budget)).toEqual([]);
  });

  test("every budgeted prompt is within its ceiling, and no ceiling has slack", async () => {
    const r = checkCounts(budget, await measure(), new Date().toISOString().slice(0, 10));
    const fails = [...r.over, ...r.missing, ...r.stale, ...r.slack];
    if (fails.length)
      console.error(
        `prompt budget (${FILE}):\n${fails.join("\n")}\n\nSteps to append (fill reason and ref):\n${steps(r.suggest)}`,
      );
    expect(r.over, "grew: a raise needs a reasoned step (METHOD.md rule 7)").toEqual([]);
    expect(r.missing, "a new prompt text needs a budget entry").toEqual([]);
    expect(r.stale, "a budgeted text is no longer measured: retire it with ceiling 0").toEqual([]);
    expect(r.slack, "shrank: lower the ceiling so it cannot grow back").toEqual([]);
  });

  test("the measurement is stable (same request twice, same counts)", async () => {
    const l = LESSONS[2];
    const [a, b] = [await writerRequest("v5.0a", l, true), await writerRequest("v5.0a", l, true)];
    expect(b.system).toBe(a.system);
    expect(b.user).toBe(a.user);
  });
});

describe("the budget rules themselves", () => {
  const step = (ceiling: number, reason: string, ref = "LOG.md v5.0a", date = "2026-11-06") => ({
    ceiling,
    date,
    reason,
    ref,
  });
  const b = (history: BudgetStep[], maxSlack = 0): PromptBudget => ({
    maxSlack,
    entries: { t: { history } },
  });

  test("one char over the ceiling fails; at the ceiling passes; under it asks to lower", () => {
    const x = b([step(100, "baseline text")]);
    expect(checkCounts(x, { t: 101 }, "2026-11-07").over).toEqual([
      "t: 101 chars, ceiling 100 (+1)",
    ]);
    const at = checkCounts(x, { t: 100 }, "2026-11-07");
    expect([...at.over, ...at.slack, ...at.missing, ...at.stale]).toEqual([]);
    expect(checkCounts(x, { t: 99 }, "2026-11-07").slack.length).toBe(1);
    expect(checkCounts(b([step(100, "baseline text")], 5), { t: 96 }, "x").slack).toEqual([]);
  });

  test("a raise needs a LOG.md, ruling, Gate B, PR or ticket ref; a cut does not", () => {
    expect(checkHistory(b([step(100, "baseline text"), step(120, "adds the X line", "")]))).toEqual(
      [
        "t history[1]: no ref",
        "t history[1]: raises 100 -> 120; ref must cite LOG.md, a ruling, Gate B, a PR or a ticket",
      ],
    );
    expect(
      checkHistory(b([step(100, "baseline text"), step(120, "adds the X line", "because")])),
    ).toEqual([
      "t history[1]: raises 100 -> 120; ref must cite LOG.md, a ruling, Gate B, a PR or a ticket",
    ]);
    expect(
      checkHistory(b([step(100, "baseline text"), step(120, "adds the X line", "ruling 312")])),
    ).toEqual([]);
    expect(
      checkHistory(b([step(100, "baseline text"), step(90, "cut the Y line", "v5.1")])),
    ).toEqual([]);
  });

  test("a reason is not reused, and steps are in date order", () => {
    expect(checkHistory(b([step(100, "baseline text"), step(110, "baseline text")]))).toEqual([
      "t history[1]: reuses an earlier reason; say why this step",
    ]);
    expect(
      checkHistory(b([step(100, "baseline text"), step(90, "cut the Y line", "x", "2026-11-01")])),
    ).toEqual(["t history[1]: dated before the step it follows"]);
  });

  test("editing or deleting a step already on master fails; appending passes", () => {
    const base = b([step(100, "baseline text")]);
    expect(checkAppendOnly(base, b([step(120, "baseline text")]))).toEqual([
      "t history[0]: changed from master; append a new step instead",
    ]);
    expect(checkAppendOnly(base, { maxSlack: 0, entries: {} })).toEqual([
      "t: removed; retire it with a last step of ceiling 0 instead",
    ]);
    expect(
      checkAppendOnly(base, b([step(100, "baseline text"), step(120, "adds X", "ruling 1")])),
    ).toEqual([]);
  });

  test("a retired text (ceiling 0) must not be sent, and is not stale when it is not", () => {
    const x = b([step(100, "baseline text"), step(0, "no longer sent", "PR #600")]);
    expect(checkCounts(x, {}, "x").stale).toEqual([]);
    expect(checkCounts(x, { t: 5 }, "x").over.length).toBe(1);
  });
});
