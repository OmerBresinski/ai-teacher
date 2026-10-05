import { describe, expect, it, test } from "bun:test";
import { richDocToPlainText } from "@tj/domain/documents";
import { KIND_TAG_NAME, materialiseSlide } from "@tj/slides";
import { batchesOf } from "../stages/plan-write";
import { answerKeyFaults, fitWithRewrite, fitWritten, renderWritten, withSetTag } from "./fit";

const META = {
  generatedBy: "test",
  promptVersion: "test",
  model: "test",
  at: "2026-09-30T00:00:00Z",
};

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
    // Round J: a heading still wrapping after its re-writes is taken at its measured height; with
    // nothing under it running past the safe area the slide fits, the heading's re-write not done.
    const same = await fitWithRewrite("explain", "default", out, async () => ({
      heading: longHeading,
    }));
    expect(same.out).toEqual(out);
    expect(same.fit.ok).toBe(true);
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

describe("no shortening after writing (Greg, 30 Sep)", () => {
  it("a failing slide keeps every item: one re-write of the named field, nothing dropped", async () => {
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
    expect(calls).toHaveLength(1);
    expect(fitted.fit.ok).toBe(false);
    expect(fitted.out).toEqual(out);
    expect(fitted.rewritten?.ok).toBe(false);
  });
});

describe("answerKeyFaults", () => {
  const pairs = [
    { left: "Igneous", right: "Formed when melted rock cools" },
    { left: "Sedimentary", right: "Layers of sediment pressed together" },
    { left: "Metamorphic", right: "Changed by heat and pressure" },
  ];
  it("accepts a key that uses each shown card once", () => {
    expect(answerKeyFaults("matching", { pairs })).toEqual([]);
    expect(answerKeyFaults("hinge", {})).toEqual([]);
  });
  it("rejects a key that is not a permutation of the cards", () => {
    const twice = [pairs[0], { ...pairs[1], right: pairs[0]?.right }, pairs[2]];
    expect(answerKeyFaults("matching", { pairs: twice })).toContain("a right card is used twice");
    const both = [pairs[0], { left: "Sedimentary", right: "Igneous" }, pairs[2]];
    expect(answerKeyFaults("matching", { pairs: both })).toContain("a card is on both sides");
  });
});

describe("set slide tags", () => {
  test("a mid-lesson check is tagged CHECK, the starter keeps STARTER", () => {
    const out = { notes: "", questions: [{ question: "When did Rome invade?", answer: "AD 43" }] };
    const tagOf = (form: string) => {
      const r = renderWritten(form, "default", out);
      const slide = withSetTag(
        materialiseSlide(r.spec, "chalk", META, () => "x"),
        form,
      );
      const tag = slide.elements.find((e) => e.name === KIND_TAG_NAME);
      return tag && tag.type === "text" ? JSON.stringify(tag.doc) : "";
    };
    expect(tagOf("check-set")).toContain("CHECK");
    expect(tagOf("check-set")).not.toContain("STARTER");
    expect(tagOf("starter-set")).toContain("STARTER");
  });
});

describe("a check-set given the practise role (smoke pw7: practice read 'Quick check')", () => {
  test("is headed Practice; a mid-lesson check keeps Quick check", () => {
    const out = {
      questions: [{ question: "Red:blue = 3:5; 12 red. How many blue?", answer: "20" }],
    };
    const heading = (role?: string) =>
      (renderWritten("check-set", "default", out, role).spec as { heading?: string }).heading;
    expect(heading("practise")).toBe("Practice");
    expect(heading("check")).toBe("Quick check");
    expect(heading()).toBe("Quick check");
  });
});

describe("a practise slide drawn as a list (round C1: B1's practice read as a list)", () => {
  test("is tagged PRACTICE; a list with any other role keeps its own tag", () => {
    const out = {
      heading: "Your turn: share in a ratio",
      body: "Draw a bar model for each one.",
      points: ["1 Share 12 in 1:2", "2 Share 20 in 2:3", "3 Spot the mistake", "4 A recipe"],
    };
    const tagOf = (role?: string) => {
      const r = renderWritten("list", "default", out, role);
      const slide = materialiseSlide(r.spec, "chalk", META, () => "x", r.variant, r.structure);
      const tag = slide.elements.find((e) => e.name === KIND_TAG_NAME);
      return tag && tag.type === "text" ? JSON.stringify(tag.doc) : "";
    };
    expect(tagOf("practise")).toContain("PRACTICE");
    expect(tagOf("teach")).not.toContain("PRACTICE");
  });

  test("is numbered by the slide: '1)' where the dot was, the writer's own number stripped (spike/fmt)", () => {
    let n = 0;
    const out = {
      heading: "Your turn: share in a ratio",
      body: "Draw a bar model for each one.",
      points: [
        "1: Share 12 in 1:2.",
        "2: Share 20 in 2:3.",
        "3: Spot the mistake.",
        "4: Scale a recipe.",
      ],
    };
    const draw = (role?: string, written = out) => {
      const r = renderWritten("list", "default", written, role);
      return materialiseSlide(r.spec, "chalk", META, () => `e${n++}`, r.variant, r.structure);
    };
    const texts = (slide: ReturnType<typeof draw>, name: string) =>
      slide.elements
        .filter((e) => e.name === name)
        .map((e) => (e.type === "text" ? richDocToPlainText(e.doc) : ""));
    const practise = draw("practise");
    // UX ruling 153: the accent disc, never "1)".
    expect(texts(practise, "Number")).toEqual(["1", "2", "3", "4"]);
    expect(practise.elements.some((e) => e.name === "Bullet")).toBe(false);
    expect(texts(practise, "Point")[0]).toBe("Share 12 in 1:2.");
    // A teaching list keeps its dots; one the writer numbered reads as ordered.
    const bare = { ...out, points: out.points.map((p) => p.slice(3)) };
    const teach = draw("teach", bare);
    expect(teach.elements.some((e) => e.name === "Number")).toBe(false);
    expect(teach.elements.some((e) => e.name === "Bullet")).toBe(true);
  });
});
