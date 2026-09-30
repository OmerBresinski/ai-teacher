import { describe, expect, it } from "bun:test";
import { batchesOf } from "../stages/plan-write";
import { fitWithRewrite, fitWritten, renderWritten, shrink } from "./fit";

const explain = {
  heading: "Water moves round the Earth",
  body: ["Heat from the Sun turns water in the sea into vapour."],
  notes: "Ask where the puddle went.",
};
const longHeading =
  "Water moves round the Earth in a cycle driven by the Sun, and it never stops moving at all";

describe("plan-write fit and re-write", () => {
  it("a slide written to its contract fits and keeps its notes", () => {
    expect(fitWritten("explain", "default", explain)).toEqual({ ok: true });
    expect(renderWritten("explain", "default", explain).spec.notes).toBe(explain.notes);
  });

  it("names the heading when it wraps, with what the slide showed", () => {
    const fit = fitWritten("explain", "default", { ...explain, heading: longHeading });
    expect(fit.ok).toBe(false);
    if (fit.ok) return;
    expect(fit.field).toBe("heading");
    expect(fit.failure).toMatch(/heading sits on \d lines, not one on \d+ of 10 themes/);
    expect(fit.failure).not.toMatch(/shorten|words|characters/i);
  });

  it("re-writes only the named field, once, and keeps it when the slide then fits", async () => {
    const asked: [string, string][] = [];
    const out = { ...explain, heading: longHeading };
    const fitted = await fitWithRewrite("explain", "default", out, async (field, failure) => {
      asked.push([field, failure]);
      return { heading: "The Sun drives the water cycle" };
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.[0]).toBe("heading");
    expect(fitted.fit.ok).toBe(true);
    expect(fitted.rewritten).toMatchObject({ field: "heading", ok: true });
    expect(fitted.out).toEqual({ ...out, heading: "The Sun drives the water cycle" });
  });

  it("keeps the slide as written, flagged, when the re-write fails or does not help", async () => {
    const out = { ...explain, heading: longHeading };
    const failed = await fitWithRewrite("explain", "default", out, async () => {
      throw new Error("model down");
    });
    expect(failed.out).toBe(out);
    expect(failed.fit.ok).toBe(false);
    expect(failed.rewritten).toMatchObject({ field: "heading", ok: false });
    const same = await fitWithRewrite("explain", "default", out, async () => ({
      heading: longHeading,
    }));
    expect(same.fit.ok).toBe(false);
    expect(same.rewritten?.ok).toBe(false);
  });

  it("never asks for a re-write when the slide fits", async () => {
    let calls = 0;
    const fitted = await fitWithRewrite("explain", "default", explain, async () => {
      calls += 1;
      return undefined;
    });
    expect(calls).toBe(0);
    expect(fitted.rewritten).toBeUndefined();
  });

  it("renders a question set with its answers in the reveal line and the notes", () => {
    const set = {
      questions: [
        { question: "What do plants need to grow?", answer: "Light and water" },
        { question: "Name the capital of France.", answer: "Paris" },
      ],
      notes: "Cold-call two pupils.",
    };
    const r = renderWritten("exit-ticket", "default", set).spec as unknown as Record<
      string,
      string
    >;
    expect(r.kind).toBe("exit-ticket");
    expect(r.footnote).toBe("Answers: 1 Light and water  ·  2 Paris");
    expect(r.notes).toContain("Cold-call two pupils.");
    expect(fitWritten("exit-ticket", "default", set)).toEqual({ ok: true });
  });
});

describe("writer batches", () => {
  it("splits slides into contiguous batches of at most 3, as even as it can", () => {
    expect(batchesOf([2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual([
      [2, 3, 4],
      [5, 6, 7],
      [8, 9, 10],
    ]);
    expect(batchesOf([2, 3, 4, 5, 6, 7, 8])).toEqual([
      [2, 3, 4],
      [5, 6],
      [7, 8],
    ]);
    expect(batchesOf([])).toEqual([]);
  });
});

describe("locate (smoke 30 Sep): a general failure names the field that breaks it", () => {
  it("a discussion prompt too big for the slide is the prompt, not the starters", () => {
    const out = {
      prompt:
        "If we make three times as much fruit drink using the same recipe, what do you predict will happen to the concentrate and water?",
      footnote: ["The concentrate will…", "The water will…"],
      notes: "Ask for predictions.",
    };
    const fit = fitWritten("discussion", "default", out);
    expect(fit.ok).toBe(false);
    if (!fit.ok) expect(fit.field).toBe("prompt");
  });

  it("a hinge whose first option is a long chain names that option", () => {
    const out = {
      stem: "Which sequence best explains how Germany's linked problems worsened into hyperinflation?",
      options: [
        "Debt and reparations → Ruhr occupation → passive resistance → money printing",
        "Money printing alone caused hyperinflation",
        "Passive resistance ended the Ruhr occupation",
        "Ruhr occupation erased wartime debt and reparations",
      ].map((text, i) => ({ text, correct: i === 0 })),
      explanation: "Debts and the Ruhr crisis led to printing.",
      notes: "Hinge.",
    };
    const fit = fitWritten("hinge", "default", out);
    expect(fit.ok).toBe(false);
    if (!fit.ok) {
      expect(fit.field).toBe("options");
      expect(fit.failure).toContain("item 1 of options");
    }
  });
});

describe("shrink (mechanical, no call)", () => {
  it("two long sentence starters on one line: the second is dropped and the slide fits", async () => {
    const out = {
      prompt: "What would make the case for more outdoor seating at school convincing?",
      footnote: ["The school should add seats because…", "This would matter to pupils because…"],
      notes: "n",
    };
    expect(fitWritten("discussion", "default", out).ok).toBe(false);
    const calls: string[] = [];
    const fitted = await fitWithRewrite("discussion", "default", out, async (f) => {
      calls.push(f);
      return undefined;
    });
    expect(calls).toEqual([]);
    expect(fitted.fit.ok).toBe(true);
    expect(fitted.shrunk).toBe(true);
    expect(fitted.out.footnote).toEqual(["The school should add seats because…"]);
  });

  it("a hinge's options lose their labelled reasons", () => {
    const out = {
      stem: "Which products form at the cathode and anode when concentrated aqueous sodium chloride is electrolysed with inert electrodes?",
      options: [
        { text: "Hydrogen / chlorine", correct: true },
        { text: "Sodium / chlorine — dissolved metal always forms", correct: false },
        { text: "Hydrogen / oxygen — water always supplies oxygen", correct: false },
        { text: "Sodium / oxygen (both rules misunderstood)", correct: false },
      ],
      explanation: "Sodium is more reactive than hydrogen.",
    };
    const small = shrink("hinge", "default", out);
    expect((small.options as { text: string }[]).map((o) => o.text)).toEqual([
      "Hydrogen / chlorine",
      "Sodium / chlorine",
      "Hydrogen / oxygen",
      "Sodium / oxygen",
    ]);
  });
});
