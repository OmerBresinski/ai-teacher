import { describe, expect, test } from "bun:test";
import { safeErrorWhere, UNRECOGNISED } from "./safe-error";

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

  test("a code fault's message outside the engine's templates is never logged", () => {
    for (const m of [
      "fetch failed for https://api.example.com/v1?key=abc123 (greg@example.com)",
      "Invalid URL: api.example.com/v1?key=abc",
      "Ada Smith",
      "sk-1234",
      "undefined is not an object (evaluating 'pupil[\"Ada Smith\"]')",
      "Cannot read properties of undefined (reading 'Ada Smith')",
    ])
      expect(safeErrorWhere(new TypeError(m)).message).toBe(UNRECOGNISED);
  });

  test("known templates are rebuilt from identifiers only", () => {
    const cases: [Error, string][] = [
      [
        new TypeError("undefined is not an object (evaluating 'slide.rows.length')"),
        "undefined is not an object (evaluating 'slide.rows.length')",
      ],
      [
        new TypeError("Cannot read properties of null (reading 'rows')"),
        "Cannot read properties of null (reading 'rows')",
      ],
      [
        new TypeError(
          `r.join is not a function. (In 'r.join(" | Ada Smith ")', 'r.join' is undefined)`,
        ),
        "r.join is not a function",
      ],
      [new TypeError("x is not iterable"), "x is not iterable"],
      [
        new ReferenceError("Cannot access 'plan' before initialization."),
        "Cannot access 'plan' before initialization",
      ],
      [new ReferenceError("foo is not defined"), "foo is not defined"],
      [new ReferenceError("Can't find variable: foo"), "Can't find variable: foo"],
      [new RangeError("Maximum call stack size exceeded."), "Maximum call stack size exceeded"],
      [new RangeError("Invalid array length"), "Invalid array length"],
    ];
    for (const [e, want] of cases) expect(safeErrorWhere(e).message).toBe(want);
  });

  test("frames come only after the message, in the strict frame shape", () => {
    const message =
      "boom 'Ada Smith'\n    at secret (sk-live-abc:1:2)\n    at /Users/ada/notes.txt:3:4";
    const e = new TypeError(message);
    e.stack = [
      `TypeError: ${message}`,
      "    at runWriter (/app/packages/generation/src/writer/stage.ts:1726:9)",
      "    at async settle (file:///app/packages/generation/src/stages/write.ts:12:3)",
      "    at /app/node_modules/pino/lib/x.js:5:6",
      "    at processTicksAndRejections (native:7:39)",
      "    at weird name with 'quotes' (x.ts:1:1)",
      "    not a frame Ada Smith",
    ].join("\n");
    const w = safeErrorWhere(e);
    expect(w.message).toBe(UNRECOGNISED);
    expect(w.stack).toEqual([
      "runWriter (packages/generation/src/writer/stage.ts:1726:9)",
      "settle (packages/generation/src/stages/write.ts:12:3)",
      "node_modules/pino/lib/x.js:5:6",
      "processTicksAndRejections (native:7:39)",
    ]);
    expect(JSON.stringify(w)).not.toMatch(/secret|Ada|sk-live|notes\.txt/);
  });

  test("a stack that does not start with its own header gives no frames", () => {
    const e = new TypeError("x is not iterable");
    e.stack = "Error: other\n    at secret (/app/packages/a.ts:1:2)";
    expect(safeErrorWhere(e)).toEqual({ message: "x is not iterable" });
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
