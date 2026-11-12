import { describe, expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import {
  type GroupElement,
  type Lesson,
  richDocToPlainText,
  type Slide,
  type SlideElement,
} from "@tj/domain/documents";
import { lesson as demoLesson } from "@tj/domain/documents/fixtures";
import pino from "pino";
import {
  applyEdit,
  deepElements,
  EDIT_MESSAGES,
  type EditFastOutput,
  EditTargetError,
  editFast,
  packEditFast,
} from "./edit-fast";
import round3 from "./fixtures/edit-chat-round3.json";

/*
 * Edit chat on v5 group slides (QA spree 1 row 2). Fixtures are real slides from the round-3 lessons
 * (scratchpad/tuning/e2e-11nov/out/round3): the objectives slide and a "reasons" Layout group with
 * reveal steps (y2-greatfire s2, s6), a visual-text slide (s4) and a worked example (y5-fractions
 * s4). An edit reads and writes text inside a group at any depth and changes only the docs: ids,
 * order, positions, reveal steps, styles and the group's layout ref stay as they were.
 */

const logger = pino({ level: "silent" });
const objectives = round3.objectives as unknown as Slide;
const reasons = round3.reasons as unknown as Slide;
const visualText = round3.visualText as unknown as Slide;
const workedExample = round3.workedExample as unknown as Slide;

const lessonWith = (slide: Slide): Lesson => ({
  ...demoLesson(),
  themeId: round3.themeId,
  yearGroup: "Year 2",
  subject: "History",
  slides: [...demoLesson().slides, slide],
});
/** The slide's path in `lessonWith`: after the demo lesson's slides. */
const PATH = `s${demoLesson().slides.length + 1}`;

const edit = (changes: { id: string; text: string }[], extra: Partial<EditFastOutput> = {}) =>
  JSON.stringify({
    action: "edit",
    reason: null,
    offer: null,
    changes: changes.map((c) => ({
      target: `${PATH}/elements/${c.id}/text`,
      text: c.text,
      node_json: null,
    })),
    summary: "Made them shorter.",
    ...extra,
  });

const out = (changes: { id: string; text: string }[]): EditFastOutput => JSON.parse(edit(changes));

const textOf = (slide: Slide, id: string) => {
  const el = deepElements(slide.elements).find((e) => e.id === id);
  return el?.type === "text" ? richDocToPlainText(el.doc) : undefined;
};

/** Everything but the docs, so a test can say "only the words changed". */
const shape = (elements: SlideElement[]): unknown =>
  elements.map((e) => {
    if (e.type === "group") return { ...e, children: shape(e.children) };
    if (e.type === "text") {
      const { doc: _doc, ...rest } = e;
      return rest;
    }
    return e;
  });

const P0 = "d-s2-layout:points.0";
const P1 = "d-s2-layout:points.1";

describe("edit chat reads the text inside groups", () => {
  test("the objectives slide (one Layout group) is no longer 'no text': every item is sent", () => {
    const input = packEditFast({
      lesson: lessonWith(objectives),
      slide: objectives,
      instruction: "Make these objectives shorter and simpler",
    });
    expect(input.target).toBe(PATH);
    const sent = JSON.parse(input.slideJson).elements as Record<string, { text: string }>;
    // Every text box, in drawing order (the card markers' numbers ride along as context, as a
    // top-level shape's text always has; a change to one is refused as outside the text boxes).
    const boxes = Object.keys(sent).filter((id) => !id.includes("~Marker"));
    expect(boxes).toEqual(["d-s2-layout:heading", P0, P1, "d-s2-layout:points.2"]);
    expect(sent[P1]?.text).toBe("Say why the fire spread and how people helped stop it.");
    // The outline names the slide by its heading, found inside the group.
    expect(input.outline.at(-1)).toBe(`${PATH} objectives "Today we are learning to"`);
  });

  test("a group child can be selected on its own (element scope)", () => {
    const input = packEditFast({
      lesson: lessonWith(objectives),
      slide: objectives,
      elementId: P1,
      instruction: "Shorter",
    });
    expect(input.target).toBe(`${PATH}/elements/${P1}/text`);
    expect(input.text).toBe("Say why the fire spread and how people helped stop it.");
  });

  test("a selected group is slide scope over its own boxes; a shape is still refused", () => {
    const input = packEditFast({
      lesson: lessonWith(reasons),
      slide: reasons,
      elementId: "d-s6-layout",
      instruction: "Simpler",
    });
    expect(input.target).toBe(PATH);
    expect(Object.keys(JSON.parse(input.slideJson).elements)).toContain(
      "d-s6-layout:reasons.1.line",
    );
    const shapeId = deepElements(objectives.elements).find((e) => e.type === "shape")?.id;
    expect(() =>
      packEditFast({
        lesson: lessonWith(objectives),
        slide: objectives,
        elementId: shapeId,
        instruction: "Shorter",
      }),
    ).toThrow(EditTargetError);
  });

  test("the visual-text and worked-example slides pack as before (top-level boxes)", () => {
    for (const slide of [visualText, workedExample]) {
      const input = packEditFast({ lesson: lessonWith(slide), slide, instruction: "Simpler" });
      const sent = JSON.parse(input.slideJson).elements as Record<string, { text: string }>;
      const tops = slide.elements.filter((e) => e.type === "text").map((e) => e.id);
      for (const id of tops) if (textOf(slide, id)?.trim()) expect(sent[id]).toBeDefined();
    }
  });
});

describe("edit chat writes the text inside groups, in place", () => {
  test("objectives at slide scope: two items change; the group, its ref and every other field stay", async () => {
    const ai = createFakeAi({
      script: [
        edit([
          { id: P0, text: "Say where the fire began and ended." },
          { id: P1, text: "Say why the fire spread." },
        ]),
      ],
    });
    const res = await editFast(
      {
        lesson: lessonWith(objectives),
        slide: objectives,
        instruction: "Make these objectives shorter and simpler",
      },
      { ai, logger },
    );
    expect(res.action).toBe("edit");
    if (res.action !== "edit") return;
    expect(res.changes.map((c) => c.elementId)).toEqual([P0, P1]);
    expect(ai.calls).toHaveLength(1);

    const applied = applyEdit(
      out([
        { id: P0, text: "Say where the fire began and ended." },
        { id: P1, text: "Say why the fire spread." },
      ]),
      PATH,
      objectives,
    );
    if ("fault" in applied) throw new Error(applied.fault);
    const [g] = applied.slide.elements as GroupElement[];
    const [g0] = objectives.elements as GroupElement[];
    expect(applied.slide.elements).toHaveLength(1);
    expect(g?.type).toBe("group");
    expect(g?.layout).toEqual(g0?.layout);
    expect(shape(applied.slide.elements)).toEqual(shape(objectives.elements));
    expect(textOf(applied.slide, P1)).toBe("Say why the fire spread.");
    expect(textOf(applied.slide, "d-s2-layout:points.2")).toBe(
      textOf(objectives, "d-s2-layout:points.2"),
    );
  });

  test("a reveal-step item keeps its step and style; untouched items are the same objects", () => {
    const id = "d-s6-layout:reasons.1.line";
    const applied = applyEdit(out([{ id, text: "The houses were close." }]), PATH, reasons);
    if ("fault" in applied) throw new Error(applied.fault);
    expect(shape(applied.slide.elements)).toEqual(shape(reasons.elements));
    const after = deepElements(applied.slide.elements).find((e) => e.id === id);
    const before = deepElements(reasons.elements).find((e) => e.id === id);
    expect(after?.revealStep).toBe(2);
    expect(after?.revealStep).toBe(before?.revealStep);
    const head = "d-s6-layout:reasons.0.head";
    expect(deepElements(applied.slide.elements).find((e) => e.id === head)).toBe(
      deepElements(reasons.elements).find((e) => e.id === head) as SlideElement,
    );
  });

  test("any depth: a visual-text slide nested two groups deep is written where it sits", () => {
    const inner: GroupElement = {
      id: "inner",
      type: "group",
      x: 10,
      y: 10,
      w: 900,
      h: 500,
      children: visualText.elements,
    } as GroupElement;
    const nested: Slide = {
      ...visualText,
      elements: [{ id: "outer", type: "group", x: 0, y: 0, w: 960, h: 540, children: [inner] }],
    } as Slide;
    const id = "d-s4-Point-0";
    const input = packEditFast({ lesson: lessonWith(nested), slide: nested, instruction: "x" });
    expect(Object.keys(JSON.parse(input.slideJson).elements)).toContain(id);
    const applied = applyEdit(out([{ id, text: "It burned many homes." }]), PATH, nested);
    if ("fault" in applied) throw new Error(applied.fault);
    expect(shape(applied.slide.elements)).toEqual(shape(nested.elements));
    expect(textOf(applied.slide, id)).toBe("It burned many homes.");
  });

  test("a group-selection edit may not reach a box outside that group", () => {
    const outside = visualText.elements.find((e) => e.type === "text") as SlideElement;
    const mixed: Slide = { ...reasons, elements: [outside, ...reasons.elements] };
    const applied = applyEdit(
      out([{ id: outside.id, text: "New heading" }]),
      PATH,
      mixed,
      new Set(["d-s6-layout:reasons.1.line"]),
    );
    expect("fault" in applied && applied.fault.startsWith("scope")).toBe(true);
  });

  test("worked example: a top-level box edit is unchanged by the group support", async () => {
    const ai = createFakeAi({
      script: [edit([{ id: "d-s4-Heading-0", text: "Add fractions" }])],
    });
    const res = await editFast(
      { lesson: lessonWith(workedExample), slide: workedExample, instruction: "Shorter heading" },
      { ai, logger },
    );
    expect(res.action).toBe("edit");
  });

  test("a group child that no longer fits its card is refused as won't fit", async () => {
    const long = "Say ".concat("where the Great Fire of London began and ".repeat(12)).trim();
    const ai = createFakeAi({
      script: [edit([{ id: P0, text: long }]), edit([{ id: P0, text: long }])],
    });
    const res = await editFast(
      {
        lesson: lessonWith(objectives),
        slide: objectives,
        elementId: P0,
        instruction: "Add detail",
      },
      { ai, logger },
    );
    expect(res).toMatchObject({ action: "refuse", check: "fit", reason: EDIT_MESSAGES.wontFit });
  });
});
