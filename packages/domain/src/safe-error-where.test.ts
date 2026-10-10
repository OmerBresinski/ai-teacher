import { describe, expect, test } from "bun:test";
import { safeErrorWhere } from "./safe-error";

/*
 * TEACH-312 part g: a generation stage failure logged only `{type: "TypeError"}`, so a
 * deterministic production throw could not be placed. `safeErrorWhere` gives the engine's message
 * for a code fault (TypeError, RangeError, ReferenceError) and the stack's frames, with anything
 * that could carry data (URLs, emails, long tokens, numbers) masked and other errors' messages
 * never read.
 */
describe("safeErrorWhere", () => {
  test("a code fault keeps the engine's message and its frames, repo-relative", () => {
    let caught: unknown;
    try {
      const slide = undefined as unknown as { rows: string[] };
      slide.rows.join(" | ");
    } catch (e) {
      caught = e;
    }
    const w = safeErrorWhere(caught);
    expect(w.message).toMatch(/undefined|rows/);
    expect(w.stack?.length).toBeGreaterThan(0);
    expect(w.stack?.[0]).toContain("safe-error-where.test.ts:");
    expect(w.stack?.join("\n")).not.toContain("/Users/");
  });

  test("another error's message is never read; its frames still are", () => {
    const e = new Error("pupil Ada Smith, key sk-live-0123456789abcdefghijklmnop");
    const w = safeErrorWhere(e);
    expect(w.message).toBeUndefined();
    expect(w.stack?.length).toBeGreaterThan(0);
    expect(JSON.stringify(w)).not.toContain("Ada");
    expect(JSON.stringify(w)).not.toContain("sk-live");
  });

  test("data inside a code fault's message is masked", () => {
    const e = new TypeError(
      "fetch failed for https://api.example.com/v1?key=abc123 (greg@example.com) token sk_0123456789abcdefghijklmnopqrstuv at 1791654097936",
    );
    const w = safeErrorWhere(e);
    expect(w.message).toBeDefined();
    for (const bad of ["api.example.com", "greg@example.com", "sk_0123456789", "1791654097936"])
      expect(w.message).not.toContain(bad);
  });

  test("non-errors and hostile values give nothing, never a throw", () => {
    expect(safeErrorWhere("secret")).toEqual({});
    expect(safeErrorWhere(null)).toEqual({});
    const hostile = Object.defineProperty(new TypeError("x"), "stack", {
      get() {
        throw new Error("boom");
      },
    });
    expect(() => safeErrorWhere(hostile)).not.toThrow();
  });
});
