import { describe, expect, test } from "bun:test";
import { type DebugRecord, fullError, recordDebug } from "./debug";

describe("recordDebug", () => {
  test("hands the record to the sink, with the slide index only when given", () => {
    const got: DebugRecord[] = [];
    recordDebug((r) => got.push(r), "check", { faults: [] }, 2);
    recordDebug((r) => got.push(r), "plan", { stage: "objectives" });
    expect(got).toEqual([
      { kind: "check", slideIndex: 2, payload: { faults: [] } },
      { kind: "plan", payload: { stage: "objectives" } },
    ]);
  });

  test("no sink records nothing; a throwing sink never reaches the stage", () => {
    expect(() => recordDebug(undefined, "event", {})).not.toThrow();
    expect(() =>
      recordDebug(
        () => {
          throw new Error("sink down");
        },
        "event",
        {},
      ),
    ).not.toThrow();
  });
});

describe("fullError", () => {
  test("keeps message, stack, code and the cause chain", () => {
    const inner = Object.assign(new Error("inner"), { code: "E_X" });
    const out = fullError(new Error("outer", { cause: inner }));
    expect(out).toMatchObject({
      name: "Error",
      message: "outer",
      cause: { message: "inner", code: "E_X" },
    });
    expect(String(out.stack)).toContain("debug.test.ts");
    expect(fullError("plain")).toEqual({ value: "plain" });
  });
});
