// Arm C cost caps, with fakes (no calls): the shared picture path's generation cap holds under
// parallel asks, and the run budget refuses a step that would cross the cap before it starts.
import { expect, test } from "bun:test";
import { guardedGenerator } from "../bakeoff/services.ts";
import { Budget } from "./budget.ts";

test("guardedGenerator (the path C's pictures use) holds the $0.06 cap under 30 parallel generations", async () => {
  let spent = 0;
  let calls = 0;
  const fake = {
    generate: async (_a: never) => {
      calls++;
      await Bun.sleep(5 + Math.random() * 20);
      spent += 0.0063; // bank onEvent -> ledger.add("pictures", cost)
      return { ok: true };
    },
  };
  const g = guardedGenerator(fake, () => spent, 0.06);
  const res = await Promise.allSettled(
    Array.from({ length: 30 }, () => g.generate(undefined as never)),
  );
  expect(spent).toBeLessThanOrEqual(0.06 + 1e-9);
  expect(calls).toBe(9); // floor(0.06 / 0.0063)
  expect(res.filter((r) => r.status === "rejected").length).toBe(21);
});

test("the run budget stops a step before it would cross the cap, parallel steps included", async () => {
  let spent = 0.1;
  const b = new Budget(0.18, () => spent, 0.01);
  // 10 parallel picture asks at $0.025 worst case: only 2 fit in 0.18 - 0.10 - 0.01 = 0.07
  const ok = Array.from({ length: 10 }, () => b.take(0.025));
  expect(ok.filter(Boolean).length).toBe(2);
  // they spend their worst case and release: spend never passes cap minus the notes tail
  spent += 0.05;
  b.release(0.025);
  b.release(0.025);
  expect(spent).toBeLessThanOrEqual(0.18 - 0.01 + 1e-9);
  expect(b.take(0.021)).toBe(false);
  expect(b.take(0.019)).toBe(true);
});
