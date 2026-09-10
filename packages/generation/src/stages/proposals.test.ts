import { describe, expect, test } from "bun:test";
import { costUsd, createBudget, DEFAULT_MODEL_IDS } from "@tj/ai";
import { createFakeAi } from "@tj/ai/testing";
import { ProposalSchema, type ProposalTarget } from "@tj/domain";
import { type SlideElement, SlideSchema, WorksheetBlockSchema } from "@tj/domain/documents";
import { generatedLesson, generatedWorksheet } from "@tj/domain/documents/fixtures";
import { materialiseSlide } from "@tj/slides";
import { PROMPT_VERSIONS } from "../prompts";
import { FIXTURES, recordingDeps } from "../testing";
import { impactSet, MAX_REDO_TARGETS, PROPOSE_CONCURRENCY, proposeFor } from "./proposals";
import { runBounded } from "./shared";

const json = (v: unknown) => JSON.stringify(v);
const usage = { inputTokens: 1000, outputTokens: 400 };
/** One fake call's cost on the standard class at the current list price (not hard-coded dollars). */
const STANDARD_CALL_USD = costUsd(DEFAULT_MODEL_IDS.standard, usage) ?? 0;

/** The domain fixture pair: `o2` is on the objectives slide (ob-2), the vocab-free slides, and block wb3. */
function fixturePair() {
  const lesson = generatedLesson();
  const worksheet = generatedWorksheet();
  return { lesson, worksheet };
}

const META = { promptVersion: "generate-slide.v1", model: "m", at: "2026-09-06T10:00:00.000Z" };

/**
 * The fixture pair with its hand-built vocabulary slide replaced by one the recipe laid out, so
 * element positions match what a re-derivation produces (as every generated slide does).
 */
function fixturePairWithRecipeVocab() {
  const { lesson, worksheet } = fixturePair();
  let n = 0;
  const slide = {
    ...materialiseSlide(FIXTURES.slides.vocabulary, lesson.themeId, META, () => `r${++n}`),
    id: "s-vocab",
  };
  lesson.slides = lesson.slides.map((s) => (s.id === "s-vocab" ? slide : s));
  const texts = slide.elements.filter((e) => e.type === "text");
  return {
    lesson,
    worksheet,
    slide,
    term: texts[1] as SlideElement,
    def: texts[4] as SlideElement,
  };
}

describe("impactSet", () => {
  test("AI elements and blocks naming a changed fact are redone; a teacher element is flagged", () => {
    const { lesson, worksheet } = fixturePair();
    // Make one of the o2 elements the teacher's.
    const objectives = lesson.slides.find((s) => s.id === "s-objectives");
    const ob2 = objectives?.elements.find((e) => e.id === "ob-2") as SlideElement;
    ob2.authoredBy = "teacher";
    // Add a second AI element on another slide that also names o2.
    const vocab = lesson.slides.find((s) => s.id === "s-vocab");
    vocab?.elements.push({
      ...(vocab.elements[1] as SlideElement),
      id: "v-extra",
      generatedFrom: {
        ...(vocab.elements[1] as SlideElement).generatedFrom,
        factRefs: ["o2"],
      } as SlideElement["generatedFrom"],
    } as SlideElement);

    const { redo, flagged } = impactSet(lesson, worksheet, ["o2"]);
    expect(redo).toEqual([{ slideId: "s-vocab", elementId: "v-extra" }, { blockId: "wb3" }]);
    expect(flagged).toEqual([{ slideId: "s-objectives", elementId: "ob-2", reason: "teacher" }]);
  });

  test("an element with no authoredBy counts as the teacher's; groups are walked", () => {
    const { lesson } = fixturePair();
    const slide = lesson.slides[1] as (typeof lesson.slides)[number];
    const [heading, ...rest] = slide.elements;
    const inserted: SlideElement = {
      id: "hand",
      type: "text",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      doc: { type: "doc" },
      style: { preset: "body" },
      generatedFrom: {
        factRefs: ["o1"],
        promptVersion: "x",
        model: "m",
        at: "2026-09-06T10:00:00.000Z",
      },
    };
    slide.elements = [
      heading as SlideElement,
      { id: "grp", type: "group", x: 0, y: 0, w: 1, h: 1, children: [...rest, inserted] },
    ];
    const { redo, flagged } = impactSet(lesson, undefined, ["o1"]);
    expect(redo.map((t) => t.elementId)).toContain("ob-1");
    expect(flagged).toEqual([{ slideId: "s-objectives", elementId: "hand", reason: "teacher" }]);
  });

  test("no worksheet: only slide targets; unrelated facts: nothing", () => {
    const { lesson } = fixturePair();
    expect(impactSet(lesson, undefined, ["o2"]).redo.every((t) => t.slideId)).toBe(true);
    expect(impactSet(lesson, undefined, ["zz9"])).toEqual({ redo: [], flagged: [] });
  });

  test("past MAX_REDO_TARGETS the rest are flagged too_many", () => {
    const { lesson } = fixturePair();
    const slide = lesson.slides[0] as (typeof lesson.slides)[number];
    const base = slide.elements[0] as SlideElement;
    slide.elements = Array.from({ length: MAX_REDO_TARGETS + 5 }, (_, i) => ({
      ...base,
      id: `m${i}`,
      generatedFrom: { ...base.generatedFrom, factRefs: ["o1"] } as SlideElement["generatedFrom"],
    })) as SlideElement[];
    const { redo, flagged } = impactSet(lesson, undefined, ["o1"]);
    const naming = impactSet(generatedLesson(), undefined, ["o1"]).redo.length;
    expect(redo).toHaveLength(MAX_REDO_TARGETS);
    // Everything past the cap: the 5 surplus on slide 1 plus the fixture's own o1 elements.
    expect(flagged.filter((t) => t.reason === "too_many")).toHaveLength(5 + naming);
  });
});

describe("proposeFor", () => {
  const mcSpec = FIXTURES.slides["multiple-choice"];
  const blockSpec = {
    type: "multiple-choice",
    text: "Which process turns vapour back into liquid water?",
    options: [
      { text: "Evaporation", correct: false },
      { text: "Condensation", correct: true },
      { text: "Freezing", correct: false },
      { text: "Melting", correct: false },
    ],
    factRefs: ["o2", "v2"],
  };

  test("cascade: one call per distinct slide and per block; proposals carry the cascade prompt version and parse", async () => {
    const { lesson, worksheet, term, def } = fixturePairWithRecipeVocab();
    // s-vocab has no `question`, so element targets stay element-level.
    const targets: ProposalTarget[] = [
      { slideId: "s-vocab", elementId: term.id },
      { slideId: "s-vocab", elementId: def.id },
      { blockId: "wb3" },
    ];
    const ai = createFakeAi({ script: [json(FIXTURES.slides.vocabulary), json(blockSpec)], usage });
    const deps = recordingDeps(ai);
    const { proposals, stoppedBy } = await proposeFor(
      targets,
      { lesson, worksheet, changedFactIds: ["v1"] },
      deps,
    );
    expect(stoppedBy).toBeUndefined();
    // Slide and block calls may interleave; both are standard-class with the right stage.
    expect(ai.calls).toHaveLength(2);
    expect(ai.calls.every((c) => c.modelClass === "standard")).toBe(true);
    expect(
      ai.calls.every(
        (c) =>
          c.context?.stage === "cascade" && c.context.promptVersion === PROMPT_VERSIONS.cascade,
      ),
    ).toBe(true);
    expect(proposals).toHaveLength(3);
    for (const p of proposals) expect(ProposalSchema.safeParse(p).success).toBe(true);
    const elementProposals = proposals.filter((p) => p.element);
    expect(elementProposals.map((p) => p.target)).toEqual([
      { slideId: "s-vocab", elementId: term.id },
      { slideId: "s-vocab", elementId: def.id },
    ]);
    expect(elementProposals.every((p) => p.question === undefined && p.notes === undefined)).toBe(
      true,
    );
    for (const p of elementProposals) {
      const original = lesson.slides
        .find((s) => s.id === "s-vocab")
        ?.elements.find((e) => e.id === p.target.elementId) as SlideElement;
      expect(p.element).toMatchObject({
        x: original.x,
        y: original.y,
        w: original.w,
        h: original.h,
        type: original.type,
        authoredBy: "ai",
      });
      expect(p.element?.id).not.toBe(original.id);
      expect(p.generatedFrom.promptVersion).toBe("cascade.v2");
    }
    const blockProposal = proposals.find((p) => p.block);
    expect(blockProposal?.target).toEqual({ blockId: "wb3" });
    expect(WorksheetBlockSchema.safeParse(blockProposal?.block).success).toBe(true);
    expect(blockProposal?.block?.id).not.toBe("wb3");
    // Nothing was written: the inputs are untouched.
    expect(worksheet).toEqual(generatedWorksheet());
    expect(lesson.slides.filter((s) => s.id !== "s-vocab")).toEqual(
      generatedLesson().slides.filter((s) => s.id !== "s-vocab"),
    );
  });

  test("regenerate: a slide-only target yields every element of the new slide, with the regenerate prompt version and the instruction in the prompt", async () => {
    const { lesson } = fixturePair();
    const ai = createFakeAi({ script: [json(mcSpec)], usage });
    const deps = recordingDeps(ai);
    const { proposals } = await proposeFor(
      [{ slideId: "s-mc" }],
      { lesson, instruction: "simpler words" },
      deps,
    );
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0]?.context?.stage).toBe("regenerate");
    expect(proposals.length).toBeGreaterThan(1);
    expect(
      proposals.every(
        (p) => p.target.slideId === "s-mc" && p.target.elementId === undefined && p.element,
      ),
    ).toBe(true);
    expect(proposals.every((p) => p.generatedFrom.promptVersion === "regenerate.v2")).toBe(true);
    // Every proposal of the slide carries the same fresh question and notes, and together they
    // form a valid slide whose answer data names the new element ids.
    const question = proposals[0]?.question;
    expect(question?.type).toBe("multiple-choice");
    expect(proposals.every((p) => p.question === question && p.notes === mcSpec.notes)).toBe(true);
    const slide = {
      id: "s-mc",
      kind: "multiple-choice" as const,
      elements: proposals.map((p) => p.element as SlideElement),
      question,
    };
    expect(SlideSchema.safeParse(slide).success).toBe(true);
    for (const p of proposals) expect(ProposalSchema.safeParse(p).success).toBe(true);
    // A re-derived slide without notes clears the old ones explicitly.
    const cleared = await proposeFor(
      [{ slideId: "s-mc" }],
      { lesson },
      recordingDeps(createFakeAi({ script: [json({ ...mcSpec, notes: undefined })], usage })),
    );
    expect(cleared.proposals.every((p) => p.notes === null)).toBe(true);
  });

  test("an element target on a question slide is widened to the whole slide (answer data names ids)", async () => {
    const { lesson } = fixturePair();
    const ai = createFakeAi({ script: [json(mcSpec)], usage });
    const { proposals } = await proposeFor(
      [{ slideId: "s-mc", elementId: "o2" }],
      { lesson, changedFactIds: ["q1"] },
      recordingDeps(ai),
    );
    expect(ai.calls).toHaveLength(1);
    expect(proposals.length).toBeGreaterThan(1);
    expect(proposals.every((p) => p.target.elementId === undefined && p.question)).toBe(true);
  });

  test("a slide-only target subsumes element targets on the same slide (one call)", async () => {
    const { lesson } = fixturePair();
    const ai = createFakeAi({ script: [json(mcSpec)], usage });
    const { proposals } = await proposeFor(
      [{ slideId: "s-mc", elementId: "q" }, { slideId: "s-mc" }],
      { lesson },
      recordingDeps(ai),
    );
    expect(ai.calls).toHaveLength(1);
    expect(proposals.every((p) => p.target.elementId === undefined)).toBe(true);
  });

  test("ten slide targets run at most PROPOSE_CONCURRENCY calls at a time", async () => {
    const { lesson } = fixturePair();
    const base = lesson.slides.find((s) => s.id === "s-mc") as (typeof lesson.slides)[number];
    lesson.slides = Array.from({ length: 10 }, (_, i) => ({ ...base, id: `mc${i}` }));
    let inFlight = 0;
    let peak = 0;
    const ai = createFakeAi({
      script: Array.from({ length: 10 }, () => async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Bun.sleep(5);
        inFlight -= 1;
        return json(mcSpec);
      }),
      usage,
    });
    const { proposals } = await proposeFor(
      lesson.slides.map((s) => ({ slideId: s.id })),
      { lesson },
      recordingDeps(ai),
    );
    expect(ai.calls).toHaveLength(10);
    expect(peak).toBeLessThanOrEqual(PROPOSE_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
    expect(new Set(proposals.map((p) => p.target.slideId)).size).toBe(10);
  });

  test("budget exhaustion ends the pass and reports it; earlier proposals are kept", async () => {
    const { lesson } = fixturePair();
    const base = lesson.slides.find((s) => s.id === "s-mc") as (typeof lesson.slides)[number];
    lesson.slides = Array.from({ length: 6 }, (_, i) => ({ ...base, id: `mc${i}` }));
    const ai = createFakeAi({ script: Array.from({ length: 6 }, () => json(mcSpec)), usage });
    // Between one and two standard calls' worth at list price.
    const deps = recordingDeps(ai, {
      budget: createBudget({ capUsd: STANDARD_CALL_USD * 1.5, capTokens: 1_000_000 }),
    });
    const result = await proposeFor(
      lesson.slides.map((s) => ({ slideId: s.id })),
      { lesson },
      deps,
    );
    expect(result.stoppedBy).toBe("usd");
    expect(ai.calls.length).toBeLessThan(6);
    expect(result.proposals.length).toBeGreaterThan(0);
  });

  test("a target the model cannot re-derive twice is skipped, not a failure", async () => {
    const { lesson } = fixturePair();
    const ai = createFakeAi({ script: ["nope", "nope"], usage });
    const { proposals, stoppedBy } = await proposeFor(
      [{ slideId: "s-mc" }],
      { lesson },
      recordingDeps(ai),
    );
    expect(proposals).toEqual([]);
    expect(stoppedBy).toBeUndefined();
  });

  test("an aborted signal throws before any call", async () => {
    const { lesson } = fixturePair();
    const deps = recordingDeps(createFakeAi({ script: [json(mcSpec)], usage }));
    deps.abort.abort();
    await expect(proposeFor([{ slideId: "s-mc" }], { lesson }, deps)).rejects.toThrow();
  });
  test("an element the teacher grouped is matched by its depth-first position and replaced in place", async () => {
    const { lesson, slide, term } = fixturePairWithRecipeVocab();
    const [heading, rule, ...rest] = slide.elements;
    slide.elements = [
      heading as SlideElement,
      rule as SlideElement,
      { id: "grp", type: "group", x: 0, y: 0, w: 1, h: 1, children: rest },
    ];
    const ai = createFakeAi({ script: [json(FIXTURES.slides.vocabulary)], usage });
    const { proposals } = await proposeFor(
      [{ slideId: "s-vocab", elementId: term.id }],
      { lesson, changedFactIds: ["v1"] },
      recordingDeps(ai),
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.target).toEqual({ slideId: "s-vocab", elementId: term.id });
    expect(proposals[0]?.element).toMatchObject({
      type: "text",
      x: term.x,
      y: term.y,
      w: term.w,
      h: term.h,
    });
    expect(proposals[0]?.element?.id).not.toBe(term.id);
  });
});

describe("runBounded", () => {
  test("processes every item with at most `limit` in flight and propagates the first error", async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];
    await runBounded([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Bun.sleep(2);
      seen.push(n);
      inFlight -= 1;
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
    await expect(
      runBounded([1, 2], 2, async (n) => {
        if (n === 2) throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
