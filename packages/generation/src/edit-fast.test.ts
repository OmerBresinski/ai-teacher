import { describe, expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import type { Lesson, RichDoc, Slide } from "@tj/domain/documents";
import {
  lesson as demoLesson,
  multipleChoiceSlide,
  text,
  textElement,
} from "@tj/domain/documents/fixtures";
import pino from "pino";
import {
  EDIT_MESSAGES,
  type EditFastOutput,
  EditTargetError,
  echoes,
  editFast,
  leakFaults,
  packEditFast,
  textToDoc,
} from "./edit-fast";
import { editFastPrompt } from "./prompts/edit-fast";

const logger = pino({ level: "silent" });

const contentSlide = (): Slide => ({
  id: "s-content",
  kind: "content",
  elements: [
    textElement("h", "Evaporation", { style: { preset: "heading" } } as never),
    textElement("b", "Water warms up and turns into a gas called water vapour.", {
      y: 140,
      h: 120,
    } as never),
  ],
});

const lesson = (slide: Slide = contentSlide()): Lesson => ({
  ...demoLesson(),
  yearGroup: "Year 4",
  subject: "Science",
  slides: [...demoLesson().slides, slide],
});

const answer = (target: string, text: string | null, extra: Partial<EditFastOutput> = {}) =>
  JSON.stringify({
    action: "edit",
    reason: null,
    offer: null,
    changes: [{ target, text, node_json: null }],
    summary: "Made it shorter.",
    ...extra,
  });

const T = "s4/elements/b/text";

describe("editFast (TEACH-97 part d)", () => {
  test("applies the model's text to the selected box, on Luna with reasoning off", async () => {
    const ai = createFakeAi({ script: [answer(T, "Water warms up and becomes a gas.")] });
    const res = await editFast(
      { lesson: lesson(), slide: contentSlide(), elementId: "b", instruction: "Shorter" },
      { ai, logger },
    );
    expect(res.action).toBe("edit");
    if (res.action !== "edit") return;
    expect(res.changes).toHaveLength(1);
    expect(res.changes[0]?.elementId).toBe("b");
    expect(res.changes[0]?.text).toBe("Water warms up and becomes a gas.");
    expect(res.summary).toBe("Made it shorter.");
    expect(res.changes[0]?.doc.content?.[0]?.type).toBe("paragraph");
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0]?.modelClass).toBe("small");
    expect(JSON.stringify(ai.calls[0]?.providerOptions)).toContain('"reasoningEffort":"none"');
    expect(JSON.stringify(ai.calls[0]?.providerOptions)).toContain('"strictJsonSchema":true');
    const prompt = ai.calls[0]?.promptText ?? "";
    expect(editFastPrompt.system.startsWith("You edit the part of a school lesson")).toBe(true);
    expect(prompt).toContain(`Selected element: ${T} = "Water warms up`);
    expect(prompt).toContain("Teacher's instruction: Shorter");
    expect(prompt).toContain('s4 content "Evaporation"');
  });

  test("a change outside the selection is retried once with the fault", async () => {
    const ai = createFakeAi({
      script: [answer("s4/elements/h/text", "Boiling"), answer(T, "Water turns into a gas.")],
    });
    const res = await editFast(
      { lesson: lesson(), slide: contentSlide(), elementId: "b", instruction: "Simpler" },
      { ai, logger },
    );
    expect(res.action).toBe("edit");
    expect(res.attempts).toBe(2);
    expect(ai.calls[1]?.promptText).toContain("Your last change failed these checks");
    expect(ai.calls[1]?.promptText).toContain("outside the selection");
  });

  test("text that cannot fit is refused in teacher words after one retry", async () => {
    const long = Array.from({ length: 120 }, () => "Water warms up and turns into vapour.").join(
      " ",
    );
    const ai = createFakeAi({ script: [answer(T, long), answer(T, long)] });
    const res = await editFast(
      { lesson: lesson(), slide: contentSlide(), elementId: "b", instruction: "Longer" },
      { ai, logger },
    );
    expect(res).toMatchObject({ action: "refuse", reason: EDIT_MESSAGES.wontFit, check: "fit" });
    expect(ai.calls).toHaveLength(2);
  });

  test("a stem that now states the keyed answer is refused", async () => {
    const mc = { ...multipleChoiceSlide(), id: "s-mc-2" };
    const leak = "Evaporation turns liquid water into vapour. Which process is it?";
    const ai = createFakeAi({
      script: [answer("s4/elements/q/text", leak), answer("s4/elements/q/text", leak)],
    });
    const res = await editFast(
      { lesson: lesson(mc), slide: mc, elementId: "q", instruction: "Easier" },
      { ai, logger },
    );
    expect(res).toMatchObject({ action: "refuse", reason: EDIT_MESSAGES.leaksAnswer });
  });

  test("the model's refusal is passed through; escalation gets the code's sentence", async () => {
    const refuse = JSON.stringify({
      action: "refuse",
      reason: "That would make the slide untrue.",
      offer: "Make the wording simpler",
      changes: [],
      summary: "",
    });
    const escalate = JSON.stringify({
      action: "escalate",
      reason: "needs a new slide",
      offer: null,
      changes: [],
      summary: "",
    });
    const req = { lesson: lesson(), slide: contentSlide(), elementId: "b", instruction: "x" };
    const a = await editFast(req, { ai: createFakeAi({ script: [refuse] }), logger });
    expect(a).toMatchObject({
      action: "refuse",
      reason: "That would make the slide untrue.",
      offer: "Make the wording simpler",
    });
    const b = await editFast(req, { ai: createFakeAi({ script: [escalate] }), logger });
    expect(b).toMatchObject({ action: "escalate", reason: EDIT_MESSAGES.needsMore });
  });

  test("the same text back is no change", async () => {
    const same = "Water warms up and turns into a gas called water vapour.";
    const res = await editFast(
      { lesson: lesson(), slide: contentSlide(), elementId: "b", instruction: "Reword" },
      { ai: createFakeAi({ script: [answer(T, same)] }), logger },
    );
    expect(res).toMatchObject({ action: "no-change", reason: EDIT_MESSAGES.noChange });
  });

  test("a slide-scope edit may change several of the slide's text boxes", async () => {
    const out = JSON.stringify({
      action: "edit",
      reason: null,
      offer: null,
      changes: [
        { target: "s4/elements/h/text", text: "Evaporating", node_json: null },
        { target: T, text: "Water warms up and becomes a gas.", node_json: null },
      ],
      summary: "Made the slide simpler.",
    });
    const ai = createFakeAi({ script: [out] });
    const res = await editFast(
      { lesson: lesson(), slide: contentSlide(), instruction: "Simpler" },
      { ai, logger },
    );
    expect(res.action).toBe("edit");
    if (res.action !== "edit") return;
    expect(res.changes.map((c) => c.elementId).sort()).toEqual(["b", "h"]);
    const prompt = ai.calls[0]?.promptText ?? "";
    expect(prompt).not.toContain("Selected element:");
    expect(prompt).toContain("Slide s4:");
  });

  test("the thread's last 3 turns reach the prompt", async () => {
    const ai = createFakeAi({ script: [answer(T, "Water becomes a gas.")] });
    const history = [1, 2, 3, 4].map((i) => ({
      instruction: `Ask ${i}`,
      summary: `Did ${i}.`,
      slides: ["s4"],
    }));
    await editFast(
      {
        lesson: lesson(),
        slide: contentSlide(),
        elementId: "b",
        instruction: "a bit more",
        history,
      },
      { ai, logger },
    );
    const prompt = ai.calls[0]?.promptText ?? "";
    expect(prompt).toContain('Teacher: "Ask 4" -> Did 4. [s4]');
    expect(prompt).not.toContain("Ask 1");
  });

  test("a slide-scope change on another slide is retried as out of scope", async () => {
    const ai = createFakeAi({
      script: [answer("s2/elements/b/text", "Other"), answer(T, "Water turns into a gas.")],
    });
    const res = await editFast(
      { lesson: lesson(), slide: contentSlide(), instruction: "Simpler" },
      { ai, logger },
    );
    expect(res.action).toBe("edit");
    expect(ai.calls[1]?.promptText).toContain("outside the selection");
  });

  test("only a text box can be edited", () => {
    const mc = multipleChoiceSlide();
    expect(() =>
      packEditFast({ lesson: lesson(mc), slide: mc, elementId: "o1", instruction: "x" }),
    ).toThrow(EditTargetError);
  });
});

test("naming the keyed option's letter is a leak; the article A is not", () => {
  const mc = { ...multipleChoiceSlide(), id: "s-mc-3" };
  const withText = (t: string) => ({
    ...mc,
    elements: mc.elements.map((e) => (e.id === "q" ? { ...e, doc: text(t) } : e)),
  });
  expect(
    leakFaults(mc, withText("Which process turns liquid water into vapour? (A)"), "q"),
  ).toHaveLength(1);
  expect(
    leakFaults(mc, withText("A process turns liquid water into vapour. Which one?"), "q"),
  ).toHaveLength(0);
});

describe("textToDoc", () => {
  test("a box that was a list stays that list, one item per line", () => {
    const list: RichDoc = {
      type: "doc",
      content: [{ type: "bulletList", content: [{ type: "listItem", content: [] }] }],
    };
    const doc = textToDoc("One\nTwo", list);
    expect(doc.content?.[0]?.type).toBe("bulletList");
    expect(doc.content?.[0]?.content).toHaveLength(2);
  });

  test("anything else is one paragraph per line", () => {
    const doc = textToDoc("One\n\nTwo", { type: "doc", content: [] });
    expect(doc.content?.map((n) => n.type)).toEqual(["paragraph", "paragraph"]);
  });
});

describe("echoes", () => {
  test("a one-word answer as a whole word; longer answers by three words in a row", () => {
    expect(echoes("It is evaporation.", "Evaporation")).toBe(true);
    expect(echoes("Evaporating water", "Evaporation")).toBe(false);
    expect(echoes("so water turns into vapour", "liquid water turns into vapour")).toBe(true);
  });
});
