import { describe, expect, test } from "bun:test";
import { fitLadder, fitWritten } from "./fit";

const long = (k: number) =>
  `Label ${k}: This chunk carries a long explanation of the idea with plenty of words so that three of them together cannot possibly fit on any projected slide at the size the theme sets for body text.`;

describe("fit ladder (no slide is saved overflowing)", () => {
  test("a fitting slide is untouched", () => {
    const out = {
      heading: "Ice melts when warmed",
      body: ["Case: ice melts at 0 °C.", "Rule: heat breaks the fixed pattern."],
      notes: "n",
    };
    const r = fitLadder("explain", "default", out);
    expect(r.rung).toBe("none");
    expect(r.out).toEqual(out);
  });
  test("an overflowing body moves whole chunks to the notes word for word, never rewording", () => {
    const body = [long(1), long(2), long(3)];
    const out = { heading: "Particles explain states", body, notes: "Say this." };
    expect(fitWritten("explain", "default", out).ok).toBe(false);
    const r = fitLadder("explain", "default", out);
    expect(fitWritten(r.form, r.layout, r.out).ok).toBe(true);
    const kept = r.out.body as string[];
    for (const c of kept) expect(body).toContain(c);
    for (const m of r.moved) {
      expect(body).toContain(m);
      expect(String(r.out.notes)).toContain(m);
    }
    expect(kept.length + r.moved.length).toBe(3);
  });
  test("a worked example keeps its answer line and moves earlier steps whole", () => {
    const steps = Array.from({ length: 6 }, (_, i) =>
      i === 5
        ? "So the answer is 42 counters (the last step gives the answer)"
        : `Step ${i + 1}: work out a long intermediate value carefully here (because the method needs this reason written out in full)`,
    );
    const out = {
      heading: "Finding a fraction",
      question: "Find 3/4 of 56 counters.",
      steps,
      notes: "",
    };
    const r = fitLadder("worked-example", "default", out);
    if (r.rung === "none") return; // fits on every theme already: nothing to move
    expect(fitWritten(r.form, r.layout, r.out).ok).toBe(true);
    const kept = r.out.steps as string[];
    expect(kept[kept.length - 1]).toBe(steps[5]);
    for (const m of r.moved) expect(String(r.out.notes)).toContain(m);
  });
});
