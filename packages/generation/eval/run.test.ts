import { describe, expect, test } from "bun:test";
import { createAi, createBudget } from "@tj/ai";
import { createFakeAi } from "@tj/ai/testing";
import { pipelineScript, scriptedPipelineAi } from "../src/testing";
import { evalBriefs } from "./briefs";
import { RUBRIC_DIMENSIONS } from "./rubric-prompt";
import {
  formatResultsTable,
  median,
  rubricTotals,
  runPaidEval,
  summarise,
  UNCONFIGURED_MESSAGE,
} from "./run";
import type { BriefResult } from "./run-brief";
import type { RubricScores } from "./scorers";

const rubricJson = (score: number) =>
  JSON.stringify({
    dimensions: Object.fromEntries(
      RUBRIC_DIMENSIONS.map((d) => [
        d,
        { score: d === "imageFit" ? null : score, rationale: "why" },
      ]),
    ),
  });

/* The paid half's loop and summary, driven on the fake — the shape CI's comment reads. */

describe("eval:paid", () => {
  test("median: middle value for odd samples, mean of the two middles for even, null for none", () => {
    expect(median([])).toBeNull();
    expect(median([7])).toBe(7);
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });

  test("without AWS_BEARER_TOKEN_BEDROCK the client is unconfigured; the script exits 2 with the message", () => {
    expect(createAi({}).kind).toBe("unconfigured");
    expect(UNCONFIGURED_MESSAGE).toContain("AWS_BEARER_TOKEN_BEDROCK");
  });

  test("a tiny shared cap stops the loop after the first brief and records stoppedBy", async () => {
    const briefs = evalBriefs().slice(0, 3);
    // The fake charges 1000/400 tokens per call on priced model ids: a cent is gone after one brief.
    const budget = createBudget({ capUsd: 0.01, capTokens: 10_000_000 });
    const rows = await runPaidEval(scriptedPipelineAi(), budget, briefs);
    expect(rows.length).toBeLessThan(briefs.length);
    const totals = summarise(rows, briefs, budget);
    expect(totals.stoppedBy).toBe("usd");
    expect(totals.briefs).toBe(3);
    expect(totals.completed + totals.failed).toBe(rows.length);
    expect(totals.costUsd).toBeGreaterThan(0.01);
  });

  test("the paid loop judges each brief: one extra frontier call, judge cost split out, rubric means in the totals", async () => {
    const [brief] = evalBriefs();
    if (!brief) throw new Error("briefs");
    const ai = createFakeAi({
      script: [...pipelineScript(), rubricJson(4)],
      usage: { inputTokens: 1000, outputTokens: 400 },
    });
    const budget = createBudget({ capUsd: 5, capTokens: 10_000_000 });
    const rows = await runPaidEval(ai, budget, [brief]);
    const row = rows[0];
    if (!row) throw new Error("no row");
    expect(row.ok).toBe(true);
    expect(ai.calls.at(-1)?.modelClass).toBe("frontier");
    expect(row.scores?.rubric?.mean).toBe(4);
    expect(row.rubricRationales?.depth).toBe("why");
    expect(row.judgeCostUsd).toBeGreaterThan(0);
    expect(row.costUsd).toBeGreaterThan(0);
    const totals = summarise(rows, [brief], budget);
    expect(totals.rubric.mean).toBe(4);
    expect(totals.rubric.dimensions.imageFit).toBeNull();
    expect(totals.judgeCostUsd).toBe(row.judgeCostUsd);
    expect(totals.costUsd).toBeCloseTo((row.costUsd ?? 0) + (row.judgeCostUsd ?? 0), 6);
  });

  test("rubricTotals: per-dimension means over the scored briefs, null when none scored", () => {
    const brief = (rubric: RubricScores | null) =>
      ({ ok: true, scores: { schema: 1, modelFindings: 1, rubric } }) as unknown as BriefResult;
    const dims = (n: number | null) =>
      Object.fromEntries(RUBRIC_DIMENSIONS.map((d) => [d, n])) as Record<
        (typeof RUBRIC_DIMENSIONS)[number],
        number | null
      >;
    expect(rubricTotals([brief(null), brief(null)]).mean).toBeNull();
    const t = rubricTotals([
      brief({ mean: 3, dimensions: dims(3) }),
      brief({ mean: 4, dimensions: { ...dims(4), imageFit: null } }),
      brief(null),
    ]);
    expect(t.dimensions.depth).toBe(3.5);
    expect(t.dimensions.imageFit).toBe(3);
    expect(t.mean).toBe(3.4); // seven at 3.5 and imageFit at 3 → 3.44 → 3.4
  });

  test("the summary and table carry counts, timings, tokens and cost — never a topic", async () => {
    const briefs = evalBriefs().slice(0, 2);
    const budget = createBudget({ capUsd: 5, capTokens: 10_000_000 });
    const ai = scriptedPipelineAi();
    // One fake answers in call order; both briefs get the whole script from a fresh fake each.
    const rows = [
      ...(await runPaidEval(ai, budget, briefs.slice(0, 1))),
      ...(await runPaidEval(scriptedPipelineAi(), budget, briefs.slice(1))),
    ];
    const totals = summarise(rows, briefs, budget);
    expect(totals.completed).toBe(2);
    expect(totals.stoppedBy).toBeUndefined();
    expect(totals.p50FirstSlideMs).toBeGreaterThanOrEqual(0);
    expect(totals.meanDurationMs).toBeGreaterThanOrEqual(0);
    const json = JSON.stringify({ briefs: rows, totals });
    for (const brief of briefs) expect(json).not.toContain(brief.input.brief.topic);
    const table = formatResultsTable({
      sha: "test",
      at: "2026-09-08T00:00:00.000Z",
      models: { frontier: "f", standard: "s", small: "m" },
      capUsd: 3,
      briefs: rows,
      totals,
    });
    expect(table).toContain("| y3-maths-fractions | yes |");
    expect(table).toContain("Totals: 2/2 briefs");
    // The fake's fallback is not a rubric answer: the judge fails on both attempts, the rubric is null.
    expect(totals.rubric.mean).toBeNull();
    expect(table).toContain("rubric mean -");
  });
});
