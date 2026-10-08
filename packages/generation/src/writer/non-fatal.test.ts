import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BudgetExceeded } from "../types";
import { isFatal, nonFatal, nonFatalSync, whenNonFatal } from "./services";

/*
 * One rule for every recovery in the writer, diagram and picture paths: a budget or abort error
 * stops the job. Every `catch` there goes through `nonFatal`, `nonFatalSync` or `whenNonFatal`
 * (services.ts), which rethrow `isFatal` errors; a bare catch is a failure here.
 */
const SRC = join(import.meta.dir, "..");
const WRITER = readdirSync(join(SRC, "writer"))
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "services.ts")
  .map((f) => `writer/${f}`);
/**
 * The picture modules (TEACH-251 part b) are moving onto the helper on their own branch; until
 * then their bare catches may only go down. Whoever lands second sets these to 0.
 */
const PICTURE_BARE: Record<string, number> = {
  "stages/picture-director.ts": 5,
  "stages/illustrate.ts": 8,
  "stages/photo-bank.ts": 10,
};

const bareCatches = (file: string) => {
  const text = readFileSync(join(SRC, file), "utf8");
  const all = text.match(/\bcatch\b/g)?.length ?? 0;
  const ok = text.match(/\.catch\(\s*whenNonFatal\(/g)?.length ?? 0;
  return all - ok;
};

describe("no bare catches in the writer, diagram and picture paths", () => {
  test("the writer and diagram modules recover only through the helper", () => {
    expect(WRITER.length).toBeGreaterThan(10);
    expect(WRITER).toContain("writer/diagrams.ts");
    for (const f of WRITER) expect(bareCatches(f), f).toBe(0);
    // The helpers themselves hold the only two catch blocks in services.ts.
    expect(
      readFileSync(join(SRC, "writer/services.ts"), "utf8").match(/\} catch \(/g)?.length,
    ).toBe(2);
  });
  test("the picture modules' bare catches never grow", () => {
    for (const [f, n] of Object.entries(PICTURE_BARE))
      expect(bareCatches(f), f).toBeLessThanOrEqual(n);
  });
});

describe("nonFatal", () => {
  const budget = new BudgetExceeded("usd");
  const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
  test("rethrows budget and abort errors, also as a cause", async () => {
    expect(isFatal(budget)).toBe(true);
    await expect(
      nonFatal(
        () => Promise.reject(budget),
        () => 1,
      ),
    ).rejects.toBe(budget);
    await expect(
      nonFatal(
        () => Promise.reject(abort),
        () => 1,
      ),
    ).rejects.toBe(abort);
    const wrapped = new Error("call failed", { cause: budget });
    expect(() =>
      nonFatalSync(
        () => {
          throw wrapped;
        },
        () => 1,
      ),
    ).toThrow("call failed");
    expect(() => whenNonFatal(() => 1)(abort)).toThrow("aborted");
  });
  test("any other error goes to onError", async () => {
    expect(
      await nonFatal(
        () => Promise.reject(new Error("x")),
        () => "kept",
      ),
    ).toBe("kept");
    expect(
      nonFatalSync(
        () => JSON.parse("{"),
        () => "kept",
      ),
    ).toBe("kept");
    expect(await Promise.reject(new Error("x")).catch(whenNonFatal(() => 7))).toBe(7);
    expect(
      await nonFatal(
        async () => 3,
        () => 0,
      ),
    ).toBe(3);
  });
});
