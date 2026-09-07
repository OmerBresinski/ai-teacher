import { describe, expect, test } from "bun:test";
import { COMMENT_MARKER, renderComment } from "./delta";
import type { EvalResults } from "./run";

const results = (over: Partial<EvalResults["totals"]> = {}, sha = "abcdef0123"): EvalResults => ({
  sha,
  at: "2026-09-08T00:00:00.000Z",
  models: { frontier: "f", standard: "s", small: "m" },
  capUsd: 3,
  briefs: [
    {
      id: "y3-maths-fractions",
      ok: true,
      durationMs: 41000,
      firstSlideMs: 8000,
      slides: 10,
      blocks: 8,
      calls: 13,
      inputTokens: 13000,
      outputTokens: 5200,
      costUsd: 0.12,
      findings: { error: 0, warning: 1 },
      scores: { schema: 1, modelFindings: 0.9 },
    },
  ],
  totals: {
    briefs: 8,
    completed: 8,
    failed: 0,
    durationMs: 320000,
    meanDurationMs: 40000,
    p50FirstSlideMs: 8000,
    calls: 104,
    inputTokens: 104000,
    outputTokens: 41600,
    costUsd: 0.96,
    findings: { error: 0, warning: 9 },
    ...over,
  },
});

describe("eval delta comment", () => {
  test("without a master run: marker, totals, no delta column", () => {
    const body = renderComment(results());
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain("8/8 briefs completed");
    expect(body).toContain("| cost | $0.9600 |");
    expect(body).toContain("No `master` baseline artifact yet");
    expect(body).not.toContain("| delta |");
  });

  test("with a master run: a delta per column, signed", () => {
    const body = renderComment(
      results({ costUsd: 1.2, meanDurationMs: 38000, findings: { error: 2, warning: 9 } }),
      results({}, "0123456789"),
    );
    expect(body).toContain("| cost | $1.2000 | $0.9600 | +$0.2400 |");
    expect(body).toContain("| mean duration | 38000 ms | 40000 ms | −2000 ms |");
    expect(body).toContain("| p50 first slide | 8000 ms | 8000 ms | ±0 ms |");
    expect(body).toContain("| error findings | 2 | 0 | +2 |");
    expect(body).toContain("master `0123456`");
  });

  test("a capped run says so", () => {
    const body = renderComment(results({ completed: 2, stoppedBy: "usd", briefs: 8 }));
    expect(body).toContain("stopped at the usd cap ($3.00)");
  });
});
