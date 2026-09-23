import { expect, test } from "bun:test";
import { createReserver, expectedCost } from "./np1-ff";

test("expected cost counts only the stages a from-facts rerun repeats", () => {
  const rows = [
    { stage: "objectives", usd: 1 },
    { stage: "facts", usd: 1 },
    { stage: "select", usd: 1 },
    { stage: "verify", usd: 0.5 },
    { stage: "generate", usd: 0.25 },
    { stage: "evaluate", usd: 0.125 },
    { stage: "repair", usd: 0.0625 },
  ];
  expect(expectedCost({ rows })).toBe(0.4375);
  expect(expectedCost({ rows }, true)).toBe(0.9375);
});

test("the batch starts a run only while its cap fits under the total; settling books actual spend", () => {
  const r = createReserver(0.1);
  expect(r.tryReserve(0.04)).toBe(true);
  expect(r.tryReserve(0.04)).toBe(true);
  expect(r.tryReserve(0.04)).toBe(false);
  r.settle(0.04, 0.01);
  expect(r.tryReserve(0.04)).toBe(true);
  r.settle(0.04, 0.03);
  r.settle(0.04, 0.02);
  expect(r.totals()).toEqual({ spent: 0.06, reserved: 0, cap: 0.1 });
  expect(r.tryReserve(0.04)).toBe(true);
  expect(r.tryReserve(0.01)).toBe(false);
});
