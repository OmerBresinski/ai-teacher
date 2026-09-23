import { describe, expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import { recordingDeps, sampleBriefLesson } from "../src/testing";
import {
  type BlindScore,
  blindKey,
  judgeOne,
  type RunToJudge,
  reportMarkdown,
  shuffle,
} from "./judge-blind";

const run = (label: string, arm: string, executed = true): RunToJudge => ({
  dir: `/r/${label}`,
  label,
  brief: "y4-history-romans",
  arm,
  executed,
  lesson: sampleBriefLesson(),
});

describe("judge-blind", () => {
  test("shuffle is a permutation, fixed by its seed, different under another", () => {
    const items = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const one = shuffle(items, 42);
    expect([...one].sort()).toEqual(items);
    expect(shuffle(items, 42)).toEqual(one);
    expect(shuffle(items, 7)).not.toEqual(one);
  });

  test("the key maps blind ids to runs and the ids carry no arm", () => {
    const runs = [
      run("np1-live-r1", "live"),
      run("np1-packed-r1", "packed"),
      run("np1-grounded-r1", "grounded"),
    ];
    const key = blindKey(runs, 3);
    expect(key.map((k) => k.blind)).toEqual(["L01", "L02", "L03"]);
    expect(new Set(key.map((k) => k.label))).toEqual(new Set(runs.map((r) => r.label)));
    for (const k of key) expect(k.blind).not.toMatch(/live|packed|grounded/);
  });

  test("a run that did not execute is not scored but keeps its row", async () => {
    const deps = recordingDeps(createFakeAi());
    const score = await judgeOne(run("x", "live", false), "L01", deps, { addendum: false });
    expect(score).toEqual({
      blind: "L01",
      rubric: null,
      addendum: null,
      error: "not executed",
      durationMs: 0,
    });
  });

  test("the report joins scores to arms through the key only", () => {
    const key = blindKey([run("a", "live"), run("b", "packed")], 1);
    const dims = (score: number) =>
      Object.fromEntries(
        [
          "correctness",
          "depth",
          "pitch",
          "coherence",
          "questionQuality",
          "notes",
          "worksheetValueAdd",
          "imageFit",
          "verbFit",
        ].map((d) => [d, { score, rationale: "r" }]),
      );
    const scores: BlindScore[] = key.map((k, i) => ({
      blind: k.blind,
      rubric: { dimensions: dims(i + 3) } as never,
      addendum: {
        fidelity: { score: 5, addedClaims: [], rationale: "" },
        wrongFacts: { score: 4, wrong: [], rationale: "" },
      },
      durationMs: 1,
    }));
    const md = reportMarkdown(key, scores);
    expect(md).toContain("| live |");
    expect(md).toContain("| packed |");
    expect(md).toContain("| arm | n judged |");
  });
});
