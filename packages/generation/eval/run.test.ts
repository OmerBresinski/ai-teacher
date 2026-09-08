import { describe, expect, test } from "bun:test";
import { createAi, createBudget } from "@tj/ai";
import { scriptedPipelineAi } from "../src/testing";
import { evalBriefs } from "./briefs";
import { formatResultsTable, median, runPaidEval, summarise, UNCONFIGURED_MESSAGE } from "./run";

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
  });
});
