import { describe, expect, it } from "bun:test";
import { z } from "zod";
// The layouts first: `./measure` reads `./labels`, which is in the layouts ↔ figures import cycle.
import "../layouts";
import { isEditorialIssue } from "../specs";
import { type Measure, measureRules, measureShape, measureText } from "./measure";

/* TEACH-98 acceptance rows 11 and 12: the value-and-label measure. */

describe("measureText", () => {
  it("row 11: the label when there is one, else the value to two places, else nothing", () => {
    expect(measureText({ value: 40 }, "°")).toBe("40°");
    expect(measureText({ value: 5.5 })).toBe("5.5");
    // biome-ignore lint/suspicious/noApproximativeNumericConstant: the ticket's value, rounded
    expect(measureText({ value: 3.14159 })).toBe("3.14");
    expect(measureText({ label: "x^2", value: 9 })).toBe("x²");
    expect(measureText({})).toBe("");
  });

  it("drops trailing zeros, prints a true minus, and treats a blank label as none", () => {
    expect(measureText({ value: 2.5 }, "°")).toBe("2.5°");
    expect(measureText({ value: 7.004 })).toBe("7");
    expect(measureText({ value: 0.1 + 0.2 })).toBe("0.3");
    expect(measureText({ value: -2.25 })).toBe("−2.25");
    expect(measureText({ value: -0.001 })).toBe("0");
    expect(measureText({ label: " ", value: 12 })).toBe("12");
    expect(measureText({ label: "5 cm", value: 5 }, "°")).toBe("5 cm");
  });
});

describe("measureRules", () => {
  const values = z.object({ side: measureShape, angle: measureShape }).superRefine((v, ctx) => {
    measureRules(ctx, ["side"], v.side, { maxLabel: 12, positive: true });
    measureRules(ctx, ["angle"], v.angle, { maxLabel: 12 });
  });
  const issues = (side: Measure, angle: Measure = {}) =>
    values.safeParse({ side, angle }).error?.issues ?? [];

  it("row 12: one editorial issue for a label over the cap, at the measure's path", () => {
    const found = issues({ label: "x".repeat(13), value: 3 });
    expect(found).toHaveLength(1);
    expect(isEditorialIssue(found[0] as object)).toBe(true);
    expect(found[0]?.path).toEqual(["side", "label"]);
    expect(found[0]?.message).toBe("Keep each label to 12 characters or fewer.");
    expect(issues({ label: "x".repeat(12), value: 3 })).toHaveLength(0);
  });

  it("row 12: one editorial issue for a value that is not positive when positive is set", () => {
    const found = issues({ value: 0 });
    expect(found).toHaveLength(1);
    expect(isEditorialIssue(found[0] as object)).toBe(true);
    expect(found[0]?.path).toEqual(["side", "value"]);
    expect(issues({ value: -1 })).toHaveLength(1);
    // Without `positive`, and with no value, there is nothing to say.
    expect(issues({ value: 2 }, { value: -30 })).toHaveLength(0);
    expect(issues({ label: "x" })).toHaveLength(0);
  });
});
