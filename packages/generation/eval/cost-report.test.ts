import { describe, expect, test } from "bun:test";
import {
  acceptedBy,
  breakEvenUses,
  coldPerAccepted,
  DEFAULT_ACCEPT,
  estimatedRows,
  type RunRow,
  reportMarkdown,
  summariseArm,
} from "./cost-report";
import { loadExperiment, runBriefs } from "./experiments/np1";

const row = (
  arm: RunRow["arm"],
  usd: number,
  accepted: boolean | null,
  executed = true,
): RunRow => ({
  label: `${arm}-${usd}`,
  brief: "b",
  arm,
  executed,
  complete: executed,
  accepted,
  usd,
  durationMs: 60_000,
});

describe("cost-report", () => {
  test("every attempt counts toward the arm's cost; only accepted lessons divide it", () => {
    const rows = [
      row("live", 0.02, true),
      row("live", 0.02, false),
      row("live", 0.01, null, false),
    ];
    const s = summariseArm("live", rows);
    expect(s).toMatchObject({
      attempts: 3,
      executed: 2,
      accepted: 1,
      judged: 2,
      usd: 0.05,
      hotPerAccepted: 0.05,
    });
    expect(summariseArm("packed", rows).hotPerAccepted).toBeNull();
  });

  test("cold cost amortises the pack build; break-even is build over saving", () => {
    const packed = summariseArm("packed", [row("packed", 0.01, true)]);
    expect(coldPerAccepted(packed, 0.5, 100)).toBeCloseTo(0.015, 6);
    expect(breakEvenUses(0.5, 0.02, 0.01)).toBe(50);
    expect(breakEvenUses(0.5, 0.01, 0.02)).toBeNull();
    expect(breakEvenUses(0.5, null, 0.02)).toBeNull();
  });

  test("acceptance is the stated rule over the judge's scores", () => {
    const dims = (score: number, correctness = score) =>
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
        ].map((d) => [d, { score: d === "correctness" ? correctness : score, rationale: "" }]),
      );
    const score = (s: number, c = s) => ({
      blind: "L01",
      rubric: { dimensions: dims(s, c) } as never,
      addendum: null,
      durationMs: 0,
    });
    expect(acceptedBy(score(4), DEFAULT_ACCEPT)).toBe(true);
    expect(acceptedBy(score(4, 3), DEFAULT_ACCEPT)).toBe(false);
    expect(acceptedBy(score(3), DEFAULT_ACCEPT)).toBe(false);
    expect(acceptedBy(undefined, DEFAULT_ACCEPT)).toBeNull();
  });

  test("the estimate table renders one row per arm with a break-even column", () => {
    const exp = loadExperiment();
    const { rows, packs } = estimatedRows(exp);
    // One row per brief × lesson arm × repeat, whatever the experiment file says.
    expect(rows.length).toBe(runBriefs(exp).length * exp.lessonArms.length * exp.repeats);
    const md = reportMarkdown(exp, rows, packs, [10, 100], DEFAULT_ACCEPT);
    expect(md).toContain("| live |");
    expect(md).toContain("| packed |");
    expect(md).toContain("cold $/accepted @100 uses");
  });
});
