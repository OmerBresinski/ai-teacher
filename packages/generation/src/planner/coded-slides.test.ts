import { describe, expect, test } from "bun:test";
import type { LessonFacts, OutlineEntry, Slide, TextElement } from "@tj/domain/documents";
import { materialiseSlide, measureHeadless, SAFE_BOTTOM, THEMES, textPartsOf } from "@tj/slides";
import { type DesignSlot, slotFormsFor } from "../prompts/design-cycle";
import {
  codedSetSpec,
  EXIT_QUIZ_MAX,
  EXIT_QUIZ_MIN,
  exitLines,
  figureOfBrief,
  fitsExitTicket,
  LINE_MAX,
  type Line,
  MAX_MINIMUM_REFILLS,
  MC_LINE_MAX,
  minimumRefills,
  misconceptionLine,
  questionLine,
  sameQuestion,
  seededOrder,
  slotRender,
  withAnswersReveal,
  withShuffledOptions,
} from "./coded-slides";
import { fitSlot } from "./slot-fit";

const mc = {
  id: "q1",
  stem: "Which vessel carries blood away from the heart?",
  answer: "artery",
  reasoning: "",
  distractors: [{ text: "vein" }, { text: "capillary" }, { text: "valve" }],
  use: "slide" as const,
};
const open = {
  id: "q2",
  stem: "Name the chamber that pumps blood to the body.",
  answer: "the left ventricle",
  reasoning: "",
  use: "slide" as const,
};
const facts = {
  objectives: [{ id: "o1", text: "describe the heart" }],
  questions: [mc, open, { ...open, id: "q3", use: "exit" as const }],
  misconceptions: [
    {
      id: "m1",
      belief: "Veins carry blue blood.",
      correction: "Blood in veins is dark red.",
      objectiveRefs: ["o1"],
    },
  ],
  outline: [],
} as unknown as LessonFacts;
const entry = (kind: OutlineEntry["kind"], factRefs: string[]): OutlineEntry =>
  ({ kind, factRefs }) as OutlineEntry;

const plain = (slide: Slide) =>
  slide.elements
    .flatMap((e) =>
      e.type === "text" || (e.type === "shape" && e.doc) ? [JSON.stringify(e.doc ?? e)] : [],
    )
    .join(" ");

describe("lab question lines (r1)", () => {
  test("a question with three distractors is one multiple-choice line; its answer names the letter", () => {
    const line = questionLine(mc, "seed");
    for (const text of ["artery", "vein", "capillary", "valve"]) expect(line.text).toContain(text);
    expect(line.text).toMatch(/ A .+ {2}B .+ {2}C .+ {2}D /);
    const letter = line.answer.slice(0, 1);
    expect(line.text).toContain(`${letter} artery`);
    expect(line.answer).toBe(`${letter} (artery)`);
  });
  test("any other question is its stem, answered in a line", () => {
    expect(questionLine(open)).toMatchObject({ text: open.stem, answer: "the left ventricle" });
    expect(questionLine(open).quiz).toEqual({ stem: open.stem, answer: "the left ventricle" });
  });
  test("a misconception is a true/false line on its belief, answered false with its correction", () => {
    expect(
      misconceptionLine(facts.misconceptions?.[0] ?? { belief: "", correction: "" }),
    ).toMatchObject({
      text: "True or false? Veins carry blue blood.",
      answer: "False. Blood in veins is dark red.",
    });
  });
});

describe("codedSetSpec (r1)", () => {
  test("a check set prints its questions verbatim, answers in the footnote and notes", () => {
    const coded = codedSetSpec(entry("instructions", ["o1", "q1", "q2"]), facts, "L:5");
    expect(coded?.spec.kind).toBe("instructions");
    const spec = coded?.spec as { steps: string[]; footnote: string; notes: string };
    expect(spec.steps).toHaveLength(2);
    expect(spec.steps[1]).toBe(open.stem);
    expect(spec.footnote).toContain("2 the left ventricle");
    expect(spec.notes).toContain("the left ventricle");
  });
  test("the exit quiz takes misconception lines too; the answers are a reveal on the slide", () => {
    const coded = codedSetSpec(entry("exit-ticket", ["o1", "q1", "q3", "m1"]), facts, "L:9");
    const items = (coded?.spec as { items: string[] } | undefined)?.items ?? [];
    expect(items).toHaveLength(3);
    expect(items[2]).toContain("True or false?");
    const slide = withAnswersReveal(
      materialiseSlide(coded?.spec as never, "chalk", {
        promptVersion: "code",
        model: "code",
        at: "2026-09-24T00:00:00.000Z",
      }),
    );
    const answers = slide.elements.find((e) => e.name === "Answers");
    expect(answers?.revealStep).toBe(1);
    expect(plain(slide)).toContain("Blood in veins is dark red.");
    const body = slide.elements.find((e) => e.type === "text" && e.style.preset === "body");
    expect((body?.y ?? 0) + (body?.h ?? 0)).toBeLessThanOrEqual(answers?.y ?? 0);
  });
  test("a starter without a question, and a question slide, stay the model's", () => {
    expect(codedSetSpec(entry("starter", ["o1", "m1"]), facts, "s")).toBeUndefined();
    expect(codedSetSpec(entry("multiple-choice", ["o1", "q1"]), facts, "s")).toBeUndefined();
  });
  test("a line over the list cap is left off, never cut", () => {
    const long = { ...open, id: "q9", stem: "x".repeat(LINE_MAX + 1) };
    const coded = codedSetSpec(
      entry("instructions", ["q9", "q2"]),
      { ...facts, questions: [long, open] } as LessonFacts,
      "s",
    );
    expect((coded?.spec as { steps: string[] } | undefined)?.steps).toEqual([open.stem]);
  });
});

describe("an options-style stem without options (25 Sep, cbm1-cb-y8-rivers-WL)", () => {
  const q7 = {
    id: "q7",
    stem: "Which of the following new housing plans would most reduce flood risk?",
    answer: "Permeable paving and green roofs",
    reasoning: "",
    distractors: [] as { text: string }[],
    use: "slide" as const,
  };
  const q5 = { ...open, id: "q5" };
  const q6 = { ...open, id: "q6", stem: "Name the vessel that returns blood to the heart." };
  const with7 = (q: typeof q7) => ({ ...facts, questions: [q5, q6, q] }) as unknown as LessonFacts;
  test("is left off the check set, and not counted as asked", () => {
    const coded = codedSetSpec(entry("instructions", ["q5", "q6", "q7"]), with7(q7), "L:5");
    expect((coded?.spec as { steps: string[] } | undefined)?.steps).toEqual([q5.stem, q6.stem]);
    expect(coded?.answers).toHaveLength(2);
    expect(coded?.questionRefs).toEqual(["q5", "q6"]);
    // Its only question dropped, the check slide is the model's.
    expect(codedSetSpec(entry("instructions", ["q7"]), with7(q7), "L:5")).toBeUndefined();
  });
  test("with three distractors it is printed as one multiple-choice line", () => {
    const listed = {
      ...q7,
      distractors: [{ text: "More car parks" }, { text: "Tarmac drives" }, { text: "Fewer trees" }],
    };
    const coded = codedSetSpec(entry("instructions", ["q7"]), with7(listed), "L:5");
    const steps = (coded?.spec as { steps: string[] } | undefined)?.steps ?? [];
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatch(/ A .+ {2}B .+ {2}C .+ {2}D /);
    expect(coded?.answers[0]).toMatch(/^[A-D] \(/);
  });
});

describe("seeded option order (r1, SYNTHESIS cause 6)", () => {
  test("the same seed gives the same order; across slides the answer is not always A", () => {
    expect(seededOrder(4, "lesson-1:5")).toEqual(seededOrder(4, "lesson-1:5"));
    expect([...seededOrder(4, "x")].sort()).toEqual([0, 1, 2, 3]);
    const spec = {
      kind: "multiple-choice" as const,
      factRefs: [],
      stem: "Which?",
      options: [
        { text: "right", correct: true },
        { text: "w1", correct: false },
        { text: "w2", correct: false },
        { text: "w3", correct: false },
      ],
    };
    const at = Array.from({ length: 20 }, (_, i) => {
      const out = withShuffledOptions(spec, `lesson-1:${i}`);
      return out.kind === "multiple-choice" ? out.options.findIndex((o) => o.correct) : -1;
    });
    expect(new Set(at).size).toBeGreaterThan(2);
    expect(at.filter((a) => a === 0).length).toBeLessThan(12);
    expect(withShuffledOptions(spec, "lesson-1:3")).toEqual(
      withShuffledOptions(spec, "lesson-1:3"),
    );
  });
});

describe("the retrieval starter (r2)", () => {
  const retrieval = [
    { question: "Which organ pumps blood around the body?", answer: "The heart" },
    {
      question: "What do we breathe in to stay alive: oxygen or carbon dioxide?",
      answer: "Oxygen",
    },
    { question: "Name one thing blood carries.", answer: "Oxygen (or food, or water)" },
  ];
  const withRetrieval = { ...facts, retrieval } as LessonFacts;

  test("a starter prints the three retrieval questions, answers shown, and none of the lesson's", () => {
    const coded = codedSetSpec(entry("starter", ["o1"]), withRetrieval, "L:2");
    const spec = coded?.spec as { kind: string; items: string[]; footnote: string; notes: string };
    expect(spec.kind).toBe("starter");
    expect(spec.items).toEqual(retrieval.map((r) => r.question));
    expect(coded?.answers).toEqual(retrieval.map((r) => r.answer));
    expect(spec.footnote).toBe(
      "Answers: 1 The heart  ·  2 Oxygen  ·  3 Oxygen (or food, or water)",
    );
    expect(spec.notes).toContain("3. Oxygen (or food, or water)");
    // A question ref on the entry (none is placed with a retrieval set) is still not printed.
    const refs = codedSetSpec(entry("starter", ["o1", "q1", "q2"]), withRetrieval, "L:2");
    expect((refs?.spec as { items?: string[] } | undefined)?.items).toEqual(
      retrieval.map((r) => r.question),
    );
    const slide = withAnswersReveal(
      materialiseSlide(coded?.spec as never, "chalk", {
        promptVersion: "code",
        model: "code",
        at: "2026-09-24T00:00:00.000Z",
      }),
    );
    expect(slide.elements.find((e) => e.name === "Answers")?.revealStep).toBe(1);
    expect(plain(slide)).toContain("The heart");
    expect(plain(slide)).toContain("Which organ pumps blood");
  });

  test("the retrieval set never reaches a check or the exit quiz", () => {
    const check = codedSetSpec(entry("instructions", ["o1", "q1", "q2"]), withRetrieval, "s");
    const exit = codedSetSpec(entry("exit-ticket", ["o1", "q1", "q3"]), withRetrieval, "s");
    for (const coded of [check, exit]) {
      const text = JSON.stringify(coded?.spec);
      for (const r of retrieval) expect(text).not.toContain(r.question);
    }
  });

  test("without a retrieval set the starter is round 1's: its question refs, or the model's", () => {
    const coded = codedSetSpec(entry("starter", ["o1", "q1", "q2"]), facts, "s");
    expect((coded?.spec as { items?: string[] } | undefined)?.items).toHaveLength(2);
    expect(codedSetSpec(entry("starter", ["o1", "m1"]), facts, "s")).toBeUndefined();
  });
});

describe("sameQuestion (pw prompts-2)", () => {
  test("the same question reworded repeats; a new number or a new question does not", () => {
    const q = (stem: string, answer: string) => ({ stem, answer });
    expect(
      sameQuestion(
        q(
          "Why did the British government move children from cities such as London in 1939?",
          "To protect them from possible bombing by moving them to safer places",
        ),
        q(
          "Why did the government move children from a British city to the countryside in 1939?",
          "To protect them from possible bombing in the city",
        ),
      ),
    ).toBe(true);
    expect(
      sameQuestion(
        q("Simplify the ratio 8:12 by dividing both parts by their HCF.", "2:3"),
        q(
          "A shop has 15 red pens and 25 blue pens. Simplify the ratio by dividing both parts by their HCF.",
          "3:5",
        ),
      ),
    ).toBe(false);
    expect(
      sameQuestion(
        q("How can a sea wall reduce erosion of a cliff?", "It reflects wave energy"),
        q(
          "Why might a sea wall cause problems further along the coast?",
          "It can increase erosion elsewhere",
        ),
      ),
    ).toBe(false);
  });
});

/*
 * TEACH-172, UX ruling 108: an exit ticket holds at most three questions and fits one slide on
 * every theme with its answers, which are revealed under the list and never over it.
 */
const words = (n: number, seed: string) => {
  let s = "";
  while (s.length < n) s += `${seed} water vapour rises and cools `;
  return `${s.slice(0, n - 1).trim()}?`;
};
/** A multiple-choice question whose printed line is `len` characters, options of `opt`. */
const mcOf = (id: string, len: number, opt = 18) => {
  const options = ["right", "alpha", "beta", "gamma"].map((w) => words(opt, w).slice(0, -1));
  const stemLen = len - options.reduce((n, o) => n + o.length + 2, 0) - 6;
  return {
    id,
    stem: words(stemLen, `why ${id}`),
    answer: options[0] as string,
    reasoning: "",
    distractors: options.slice(1).map((text) => ({ text })),
    use: "exit" as const,
  };
};
const exitFacts = (qs: ReturnType<typeof mcOf>[]) =>
  ({ ...facts, questions: qs, misconceptions: [] }) as unknown as LessonFacts;
const exitSpec = (qs: ReturnType<typeof mcOf>[]) =>
  codedSetSpec(
    entry(
      "exit-ticket",
      qs.map((q) => q.id),
    ),
    exitFacts(qs),
    "L:9",
  );
const itemsOf = (coded: ReturnType<typeof codedSetSpec>) => {
  if (coded?.spec.kind !== "exit-ticket") throw new Error("no exit ticket");
  return coded.spec.items;
};
const meta = { promptVersion: "code", model: "code", at: "2026-09-27T00:00:00.000Z" };
const needOf = (slide: Slide, el: TextElement, themeId: string) => {
  const theme = THEMES.find((t) => t.id === themeId);
  const parts = textPartsOf(el, slide);
  if (!theme || !parts) throw new Error(themeId);
  return measureHeadless(theme)({ ...parts, width: el.w });
};

describe("the exit ticket: one line per objective, on one slide (TEACH-172)", () => {
  test("the cap is four, one per objective; one prints a ticket", () => {
    expect(EXIT_QUIZ_MAX).toBe(4);
    expect(EXIT_QUIZ_MIN).toBe(1);
  });

  test("a check question standing in for an objective's exit line is asked as its stem", () => {
    const exit = mcOf("a", 80, 8);
    const check = { ...mcOf("b", 90, 8), use: "slide" as const };
    const items = itemsOf(
      codedSetSpec(
        entry("exit-ticket", ["a", "b"]),
        exitFacts([exit, check as unknown as typeof exit]),
        "L:9",
      ),
    );
    expect(items[0]).toContain("A ");
    // The stand-in: the stem alone, no options, its answer still revealed.
    expect(items[1]).toBe(check.stem.trim());
  });

  test("five short questions: the first three are kept, in order", () => {
    const qs = ["a", "b", "c", "d", "e"].map((id) => mcOf(id, 80, 8));
    const items = itemsOf(exitSpec(qs));
    expect(items).toHaveLength(3);
    expect(items.map((t) => t.slice(0, 20))).toEqual(
      qs.slice(0, 3).map((q) => q.stem.slice(0, 20)),
    );
  });

  test("three multiple-choice lines at the 240-character cap do not fit: fewer are kept, and they fit", () => {
    const qs = ["a", "b", "c"].map((id) => mcOf(id, MC_LINE_MAX, 40));
    const lines = qs.map((q) => questionLine(q, "s"));
    expect(lines.every((l) => l.text.length <= MC_LINE_MAX)).toBe(true);
    expect(fitsExitTicket(lines)).toBe(false);
    const kept = exitLines(lines);
    expect(kept.length).toBeGreaterThanOrEqual(1);
    expect(kept.length).toBeLessThan(3);
    expect(fitsExitTicket(kept)).toBe(true);
  });

  test("a line that does not fit is passed over for a later, shorter one", () => {
    const long = questionLine(mcOf("a", MC_LINE_MAX, 40), "s");
    const lines: Line[] = [long, long, questionLine(mcOf("c", 70, 8), "s")];
    const kept = exitLines(lines);
    expect(kept.at(-1)?.text).toBe(lines[2]?.text);
    expect(fitsExitTicket(kept)).toBe(true);
  });

  test("one line is always kept, even when nothing fits beside it", () => {
    const one = { text: "x".repeat(LINE_MAX), answer: "y ".repeat(300).trim() };
    expect(exitLines([one])).toEqual([one]);
  });

  // The maximum: the longest three lines the measure keeps, found by growing them together.
  let max = 60;
  while (fitsExitTicket(["a", "b", "c"].map((id) => questionLine(mcOf(id, max + 5), "s"))))
    max += 5;
  const atMax = ["a", "b", "c"].map((id) => mcOf(id, max));

  for (const theme of THEMES) {
    test(`${theme.id}: three questions at the maximum (${max} characters a line) fit with their answers under the list`, () => {
      const coded = exitSpec(atMax);
      expect(itemsOf(coded)).toHaveLength(3);
      const slide = withAnswersReveal(
        materialiseSlide(coded?.spec as never, theme.id, meta),
        theme.id,
      );
      const body = slide.elements.find(
        (e): e is TextElement => e.type === "text" && e.style.preset === "body",
      );
      const answers = slide.elements.find(
        (e): e is TextElement => e.type === "text" && e.name === "Answers",
      );
      if (!body || !answers) throw new Error("no list or answers");
      // The list's words fit its box, the answers start below it and hold their words, and all of
      // it stays inside the safe area: nothing overflows and no answer covers a question.
      expect(needOf(slide, body, theme.id)).toBeLessThanOrEqual(body.h + 0.5);
      expect(body.y + body.h).toBeLessThanOrEqual(answers.y);
      expect(needOf(slide, answers, theme.id)).toBeLessThanOrEqual(answers.h + 0.5);
      expect(answers.y + answers.h).toBeLessThanOrEqual(SAFE_BOTTOM);
      expect(answers.revealStep).toBe(1);
    });
  }
});

const META = { promptVersion: "t", model: "t", at: "1970-01-01T00:00:00.000Z" };

describe("figure slots draw their template (ADR 0032)", () => {
  const slot = (values?: Record<string, unknown>): DesignSlot => ({
    form: "figure",
    heading: "Find the missing side",
    body: "Use Pythagoras' theorem to find the hypotenuse x.",
    figureBrief: {
      template: "right-triangle",
      purpose: "a right-angled triangle with the hypotenuse to find",
      ...(values ? { values } : {}),
    },
  });
  const valid = {
    base: { length: 6, label: "6 cm" },
    height: { length: 8, label: "8 cm" },
    hypotenuse: { label: "x" },
  };

  test("valid values: a diagram slide drawing the template, in the template's variant", async () => {
    const r = slotRender(slot(valid), "seed");
    expect(r.spec.kind).toBe("diagram");
    expect((r.spec as { figure?: { template: string } }).figure?.template).toBe("right-triangle");
    const slide = materialiseSlide(r.spec, "chalk", META, undefined, r.variant, r.structure);
    const group = slide.elements.find((e) => e.type === "group");
    expect((group as { figure?: { template: string } } | undefined)?.figure?.template).toBe(
      "right-triangle",
    );
    const fit = await fitSlot(slot(valid), { seed: "s", themeId: "chalk" });
    expect(fit.render.spec.kind).toBe("diagram");
  });

  test("no values, or values the template's rules refuse: the labelled placeholder", () => {
    for (const values of [
      undefined,
      { base: { length: 6, label: "6 cm" } },
      {
        base: { length: 3, label: "3" },
        height: { length: 4, label: "4" },
        hypotenuse: { length: 9, label: "9" },
      },
    ]) {
      const r = slotRender(slot(values), "seed");
      expect(r.spec.kind).toBe("content");
      expect((r.spec as { diagram?: string }).diagram).toBe(
        "a right-angled triangle with the hypotenuse to find",
      );
    }
    expect(figureOfBrief({ template: "right-triangle", values: valid })?.values).toBeDefined();
  });
});

describe("design minimums enforced (designer eval r1)", () => {
  const offered = slotFormsFor("science");
  const arc = (lean: string) => ({ lean });
  test("an objective that needs a visual and has none: its first text slot becomes the visual", () => {
    const placed = [
      { objective: 0, form: "explain" as const, slide: 4 },
      { objective: 0, form: "list" as const, slide: 5 },
      { objective: 0, form: "true-false" as const, slide: 6 },
      { objective: 1, form: "photo" as const, slide: 7 },
      { objective: 1, form: "hinge" as const, slide: 8 },
      { objective: 1, form: "open-response" as const, slide: 9 },
    ];
    expect(minimumRefills(placed, [arc("photo"), arc("explain")], offered)).toEqual([
      {
        slide: 4,
        objective: 0,
        into: "photo",
        reason: "the objective has no photo, figure or diagram; this slot shows its content",
      },
    ]);
    // A structural lean (sequence) gets a diagram slot.
    expect(minimumRefills(placed, [arc("sequence"), arc("explain")], offered)[0]?.into).toBe(
      "diagram-slot",
    );
  });

  test("fewer than 3 checks: a text slot becomes a true-false, never an objective's last teaching slot", () => {
    const placed = [
      { objective: 0, form: "explain" as const, slide: 4 },
      { objective: 0, form: "list" as const, slide: 5 },
      { objective: 1, form: "explain" as const, slide: 6 },
      { objective: 1, form: "true-false" as const, slide: 7 },
    ];
    const out = minimumRefills(placed, [arc("explain"), arc("explain")], offered);
    expect(out).toEqual([
      {
        slide: 5,
        objective: 0,
        into: "true-false",
        reason: "the lesson needs another check; this slot checks the objective",
      },
    ]);
  });

  test("roles: a show slot that came back as text becomes its visual, a check that came back open a true-false", () => {
    const placed = [
      { objective: 0, form: "explain" as const, slide: 4, role: "show" as const },
      { objective: 0, form: "hinge" as const, slide: 5, role: "check" as const },
      { objective: 1, form: "explain" as const, slide: 6, role: "teach" as const },
      { objective: 1, form: "open-response" as const, slide: 7, role: "check" as const },
      { objective: 2, form: "worked-example" as const, slide: 8, role: "teach" as const },
      { objective: 2, form: "open-response" as const, slide: 9, role: "practise" as const },
    ];
    const out = minimumRefills(
      placed,
      [arc("figure"), arc("explain"), arc("worked-example")],
      [...offered],
    );
    // Slide 4 is objective 0's only teaching slot: kept (designer r3); its one check stays too.
    expect(out.map((m) => [m.slide, m.into, m.role])).toEqual([[7, "true-false", "check"]]);
    // With a second teaching slot, the show slot that came back as text becomes the visual.
    const taught = [
      { objective: 0, form: "explain" as const, slide: 3, role: "show" as const },
      { objective: 0, form: "list" as const, slide: 4, role: "teach" as const },
      ...placed.slice(1),
    ];
    expect(
      minimumRefills(taught, [arc("figure"), arc("explain"), arc("worked-example")], offered).map(
        (m) => [m.slide, m.into, m.role],
      ),
    ).toEqual([
      [3, "figure", "show"],
      [7, "true-false", "check"],
    ]);
    // Within the cap of 2 a lesson: a third role miss waits.
    const more = [
      ...placed,
      { objective: 2, form: "discussion" as const, slide: 10, role: "check" as const },
    ];
    expect(
      minimumRefills(more, [arc("figure"), arc("explain"), arc("worked-example")], offered),
    ).toHaveLength(MAX_MINIMUM_REFILLS);
    // Slots held to their roles: nothing to re-fill for a role.
    const held = placed.map((p) => ({ ...p, role: undefined }));
    expect(minimumRefills(held, [arc("explain"), arc("explain"), arc("explain")], offered)).toEqual(
      [],
    );
  });

  test("at most two re-fills a lesson, visuals first", () => {
    const placed = [0, 1, 2].flatMap((o) => [
      { objective: o, form: "explain" as const, slide: 4 + o * 2 },
      { objective: o, form: "list" as const, slide: 5 + o * 2 },
    ]);
    const out = minimumRefills(placed, [arc("photo"), arc("photo"), arc("photo")], offered);
    expect(out).toHaveLength(MAX_MINIMUM_REFILLS);
    expect(out.every((m) => m.into === "photo")).toBe(true);
    expect(minimumRefills([], [], offered)).toEqual([]);
  });
});

describe("the visual minimum keeps the teaching (designer r3)", () => {
  const offered = slotFormsFor("science");
  const arc = (lean: string) => ({ lean });
  test("a 2-slot cycle's explain-callout is never re-filled into its visual", () => {
    const placed = [
      { objective: 0, form: "explain-callout" as const, slide: 4, role: "show" as const },
      { objective: 0, form: "hinge" as const, slide: 5, role: "check" as const },
      { objective: 1, form: "diagram-slot" as const, slide: 6, role: "show" as const },
      { objective: 1, form: "true-false" as const, slide: 7, role: "check" as const },
      { objective: 2, form: "explain-callout" as const, slide: 8 },
      { objective: 2, form: "sort" as const, slide: 9 },
    ];
    const arcs = [arc("diagram-slot"), arc("diagram-slot"), arc("photo")];
    expect(minimumRefills(placed, arcs, offered)).toEqual([]);
    // Unroled too: the callout slot is the only teaching, so the visual stays missing (logged).
    const unroled = placed.map(({ role: _, ...p }) => p);
    expect(minimumRefills(unroled, arcs, offered)).toEqual([]);
  });

  test("a callout slot is spared even beside another text slot; the plain one becomes the visual", () => {
    const placed = [
      { objective: 0, form: "explain-callout" as const, slide: 4 },
      { objective: 0, form: "explain" as const, slide: 5 },
      { objective: 0, form: "hinge" as const, slide: 6 },
    ];
    expect(minimumRefills(placed, [arc("photo")], offered).map((m) => m.slide)).toEqual([5]);
    // Two callout slots: neither goes.
    const both = placed.map((p) =>
      p.slide === 5 ? { ...p, form: "explain-callout" as const } : p,
    );
    expect(minimumRefills(both, [arc("photo")], offered)).toEqual([]);
  });

  test("the visual takes a check only when the objective keeps another and the lesson keeps 3", () => {
    const placed = [
      { objective: 0, form: "explain-callout" as const, slide: 4 },
      { objective: 0, form: "hinge" as const, slide: 5 },
      { objective: 0, form: "true-false" as const, slide: 6 },
      { objective: 1, form: "explain" as const, slide: 7 },
      { objective: 1, form: "sort" as const, slide: 8 },
      { objective: 1, form: "matching" as const, slide: 9 },
    ];
    const out = minimumRefills(placed, [arc("photo"), arc("explain")], offered);
    expect(out.map((m) => [m.slide, m.into])).toEqual([[5, "photo"]]);
    // At 3 checks in the lesson, no check is spent: the visual stays missing.
    const three = placed.filter((p) => p.slide !== 9);
    expect(minimumRefills(three, [arc("photo"), arc("explain")], offered)).toEqual([]);
  });

  test("the check minimum never re-fills a callout slot", () => {
    const placed = [
      { objective: 0, form: "explain" as const, slide: 4 },
      { objective: 0, form: "explain-callout" as const, slide: 5 },
      { objective: 1, form: "explain" as const, slide: 6 },
      { objective: 1, form: "true-false" as const, slide: 7 },
    ];
    expect(
      minimumRefills(placed, [arc("explain"), arc("explain")], offered).map((m) => m.slide),
    ).toEqual([4]);
  });
});
