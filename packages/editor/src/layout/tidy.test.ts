import { describe, expect, test } from "bun:test";
import {
  type Lesson,
  parseLesson,
  type ShapeElement,
  type Slide,
  type SlideElement,
  type TextElement,
} from "@tj/domain/documents";
import { generatedFrom } from "@tj/domain/documents/fixtures";
import { BODY_Y, materialiseSlide } from "@tj/slides";
import { docFromText, newLesson, newSlide } from "../model/factories";
import { getTheme } from "../model/themes";
import { docToPlainText } from "../text/static";
import { lintSlide } from "./lint";
import { docLineCount, reflowSlide } from "./reflow";
import { rulerFor } from "./test-ruler";
import { tidyMessage, tidySlide, tidySlideReducer } from "./tidy";

/* `tidySlide` as a pure function over the lesson (TeachDeck's wrote the store). */

const theme = getTheme("chalk");
const ruler = rulerFor(theme);

const text = (
  id: string,
  y: number,
  h: number,
  words: string,
  preset: "heading" | "body" = "body",
): TextElement => ({
  id,
  type: "text",
  x: 58,
  y,
  w: 844,
  h,
  doc: docFromText(words),
  style: { preset, autoHeight: true },
});

function lessonWith(elements: TextElement[]): Lesson {
  const lesson = newLesson("Tidy", "chalk");
  const first = lesson.slides[0];
  if (!first) throw new Error("seed");
  first.elements = elements;
  return lesson;
}

describe("tidySlide", () => {
  test("is idempotent: a second tidy returns the same lesson object and changed: false", () => {
    const lesson = lessonWith([
      text("a", 43, 60, "Heading", "heading"),
      text("b", 140, 200, "A short body."),
    ]);
    const sid = lesson.slides[0]?.id ?? "";
    const once = tidySlide(lesson, sid, ruler).lesson;
    const twice = tidySlide(once, sid, ruler);
    expect(twice.lesson).toBe(once);
    expect(twice.outcome.changed).toBe(false);
    expect(tidyMessage(twice.outcome)).toBe("Nothing to tidy");
  });

  test("a body pushed into by a grown heading is moved down; the outcome counts it", () => {
    // Two boxes 10pt apart; the heading is stored at 20pt but its two long lines need more.
    const long = "A heading that runs well past a single line of the slide at the projector size";
    const lesson = lessonWith([
      text("h", 43, 20, long, "heading"),
      text("b", 73, 200, "Body copy."),
    ]);
    const sid = lesson.slides[0]?.id ?? "";
    expect(lintSlide(lesson.slides[0] as never, ruler).ok).toBe(true);
    const out = tidySlide(lesson, sid, ruler);
    expect(out.lesson).not.toBe(lesson);
    expect(out.outcome.changed).toBe(true);
    const [h, b] = out.lesson.slides[0]?.elements ?? [];
    expect((h?.h ?? 0) > 20).toBe(true);
    expect((b?.y ?? 0) > (h?.y ?? 0) + (h?.h ?? 0) - 1).toBe(true);
    // Other slides keep their identity: one slide changed, one reducer step.
    expect(out.lesson.slides.length).toBe(lesson.slides.length);
    expect(tidyMessage(out.outcome)).toMatch(/^Tidied: /);
  });

  test("an overlong list continues on a new slide of the same kind, its heading marked", () => {
    const items = Array.from(
      { length: 40 },
      (_, i) => `Item number ${i + 1} on this very long list of things`,
    );
    const list = text("list", 120, 300, items.join("\n"));
    const lesson = lessonWith([text("h", 43, 60, "Learning objectives", "heading"), list]);
    const sid = lesson.slides[0]?.id ?? "";
    const out = tidySlide(lesson, sid, ruler);
    expect(out.outcome.changed).toBe(true);
    expect(out.outcome.continued).toBeGreaterThanOrEqual(1);
    expect(out.lesson.slides.length).toBe(lesson.slides.length + out.outcome.continued);
    const next = out.lesson.slides[1];
    expect(next?.kind).toBe(lesson.slides[0]?.kind);
    const heading = next?.elements.find((e) => e.type === "text" && e.style.preset === "heading");
    expect(docToPlainText((heading as TextElement).doc)).toBe("Learning objectives (continued)");
    expect(tidyMessage(out.outcome)).toContain("continued on");
  });

  test("TEACH-74: a split of an ai list is the engine's doing, not a teacher edit", () => {
    const items = Array.from(
      { length: 40 },
      (_, i) => `Item number ${i + 1} on this very long list of things`,
    );
    const list: TextElement = {
      ...text("list", 120, 300, items.join("\n")),
      generatedFrom: generatedFrom(["o1"]),
      authoredBy: "ai",
    };
    const lesson = lessonWith([text("h", 43, 60, "Learning objectives", "heading"), list]);
    const sid = lesson.slides[0]?.id ?? "";
    const out = tidySlide(lesson, sid, ruler);
    expect(out.outcome.continued).toBeGreaterThanOrEqual(1);
    // The head of the list is shorter now, but nobody typed: still the AI's, nothing kept.
    const head = out.lesson.slides[0]?.elements.find((e) => e.id === "list") as TextElement;
    expect(docToPlainText(head.doc).length).toBeLessThan(items.join("\n").length);
    expect(head.authoredBy).toBe("ai");
    expect(head.generatedFrom?.originalText).toBeUndefined();
    expect("originalText" in (head.generatedFrom ?? {})).toBe(false);
    // The carried-over tail keeps the same provenance: the AI wrote those words too.
    const tail = out.lesson.slides[1]?.elements.find(
      (e) => e.type === "text" && e.style.preset !== "heading",
    ) as TextElement;
    expect(tail.authoredBy).toBe("ai");
    expect(tail.generatedFrom).toEqual(generatedFrom(["o1"]));
    expect(parseLesson(out.lesson)).toEqual(out.lesson);
  });

  test("an unknown slide id is a no-op", () => {
    const lesson = newLesson("X", "chalk");
    expect(tidySlide(lesson, "nope", ruler).lesson).toBe(lesson);
  });

  test("a recipe slide settles to its measured heights and then stays put", () => {
    const lesson = newLesson("Y", "chalk");
    lesson.slides = [newSlide("objectives", "chalk")];
    const sid = lesson.slides[0]?.id ?? "";
    const once = tidySlide(lesson, sid, ruler);
    expect(once.outcome.overflow).toEqual([]);
    expect(once.outcome.continued).toBe(0);
    expect(tidySlide(once.lesson, sid, ruler).outcome.changed).toBe(false);
  });
});

describe("TEACH-247: a worked-example at the spec's limits fits its card", () => {
  test("four 56-character steps and a two-line question leave no overflow after tidy", () => {
    const step = "Gnawing scrapes and wears the incisors down to length.";
    expect(step.length).toBeLessThanOrEqual(56);
    const slide = materialiseSlide(
      {
        kind: "worked-example",
        heading: "Why does a mouse gnaw a hard seed?",
        // At the spec's cap (120 characters) to within a word.
        question:
          "A mouse's front incisors have grown longer than they were last month. Explain in two sentences why it gnaws hard nuts.",
        steps: [step, step, step, step],
        factRefs: ["x1"],
      },
      "chalk",
      { promptVersion: "test", model: "test", at: "2026-09-11T00:00:00.000Z" },
      (() => {
        let n = 0;
        return () => `e${++n}`;
      })(),
    );
    const lesson = newLesson("W", "chalk");
    lesson.slides = [slide];
    const out = tidySlide(lesson, slide.id, ruler);
    expect(out.outcome.overflow).toEqual([]);
    const after = out.lesson.slides[0];
    if (!after) throw new Error("slide");
    expect(lintSlide(after, ruler, theme).ok).toBe(true);
  });
});

describe("TEACH-248: steps at the tolerant ceiling never throw", () => {
  test("four 120-character steps materialise and tidy; any overflow is reported, not thrown", () => {
    const step = "s".repeat(120);
    const slide = materialiseSlide(
      {
        kind: "worked-example",
        heading: "Long steps",
        question: "Why?",
        steps: [step, step, step, step],
        factRefs: ["x1"],
      },
      "chalk",
      { promptVersion: "test", model: "test", at: "2026-09-11T00:00:00.000Z" },
      (() => {
        let n = 0;
        return () => `e${++n}`;
      })(),
    );
    const lesson = newLesson("L", "chalk");
    lesson.slides = [slide];
    expect(() => tidySlide(lesson, slide.id, ruler)).not.toThrow();
  });
});

describe("tidyMessage", () => {
  test("names what happened, and what still will not fit", () => {
    expect(
      tidyMessage({
        moved: 2,
        stepped: 1,
        continued: 0,
        overflow: [],
        laneOverflow: [],
        changed: true,
      }),
    ).toBe("Tidied: 2 boxes moved, 1 size stepped down");
    expect(
      tidyMessage({
        moved: 0,
        stepped: 0,
        continued: 2,
        overflow: ["x"],
        laneOverflow: [],
        changed: true,
      }),
    ).toBe(
      "Tidied: list continued on 2 new slides. 1 box will not fit at the smallest readable size",
    );
    expect(
      tidyMessage({
        moved: 0,
        stepped: 0,
        continued: 0,
        overflow: [],
        laneOverflow: ["a", "b"],
        changed: false,
      }),
    ).toBe("Nothing left to tidy: 2 boxes still covers the room the reason needs");
    expect(
      tidyMessage({
        moved: 0,
        stepped: 1,
        continued: 0,
        overflow: ["x", "y"],
        overflowText: ["The Provisional Government continued the\u2026", "Working card"],
        laneOverflow: [],
        changed: true,
      }),
    ).toBe(
      'Tidied: 1 size stepped down. 2 boxes will not fit at the smallest readable size ("The Provisional Government continued the\u2026", "Working card")',
    );
  });
});

describe("fills continuations and splits worked examples (TEACH-18)", () => {
  const rule = (id: string, y: number): ShapeElement => ({
    id,
    type: "shape",
    shape: "rounded",
    x: 58,
    y,
    w: 844,
    h: 1,
  });
  const lessonOf = (elements: SlideElement[]): Lesson => {
    const lesson = newLesson("Tidy", "chalk");
    const first = lesson.slides[0];
    if (!first) throw new Error("seed");
    first.elements = elements;
    return lesson;
  };
  const sidOf = (lesson: Lesson) => lesson.slides[0]?.id ?? "";
  const bodies = (s: Slide | undefined) =>
    (s?.elements ?? []).filter(
      (e): e is TextElement => e.type === "text" && e.style.preset === "body",
    );
  const headingOf = (s: Slide | undefined) => {
    const h = s?.elements.find((e) => e.type === "text" && e.style.preset === "heading");
    return h?.type === "text" ? docToPlainText(h.doc) : "";
  };
  const byId = (s: Slide | undefined, id: string) => s?.elements.find((e) => e.id === id);
  // Three body lines at the projector size.
  const para =
    "The Provisional Government kept Russia in the war, put off land reform and lost the cities " +
    "to the soviets, so the Bolshevik promise of peace, land and bread found a ready audience.";
  // Two body lines at the projector size.
  const item = (i: number) =>
    `Point ${i}: a full explanation that a teacher might add under the paragraph, long enough ` +
    "to wrap onto a second line.";
  const items = (n: number) => Array.from({ length: n }, (_, i) => item(i + 1));
  const slideOf = (n: number) =>
    lessonOf([
      text("h", 43, 60, "Why the Bolsheviks gained support", "heading"),
      rule("r", 110),
      text("p", 140, 90, para),
      text("list", 250, 200, items(n).join("\n")),
    ]);

  test("AC1: six items under a paragraph continue once, at the body top, without the paragraph", () => {
    const lesson = slideOf(6);
    const out = tidySlide(lesson, sidOf(lesson), ruler);
    expect(out.outcome.continued).toBe(1);
    expect(out.outcome.overflow).toEqual([]);
    const [head, cont] = out.lesson.slides;
    const headList = byId(head, "list");
    if (headList?.type !== "text") throw new Error("head list");
    const kept = docLineCount(headList.doc);
    expect(kept).toBeGreaterThanOrEqual(1);
    expect(kept).toBeLessThan(6);
    expect(byId(head, "p")).toBeDefined();
    const carried = bodies(cont);
    expect(carried.length).toBe(1);
    const tail = carried[0];
    if (!tail) throw new Error("tail");
    expect(docLineCount(tail.doc)).toBe(6 - kept);
    expect(tail.y).toBe(BODY_Y);
    expect(docToPlainText(tail.doc)).not.toContain("Provisional Government");
    expect(headingOf(cont)).toBe("Why the Bolsheviks gained support (continued)");
    expect(cont?.elements.some((e) => e.type === "shape" && e.h === 1)).toBe(true);
    expect(cont?.kind).toBe(head?.kind);
    expect(tidyMessage(out.outcome)).toContain("list continued on a new slide");
  });

  test("AC2: eighteen items take the fewest continuations, each filled before the next starts", () => {
    const lesson = slideOf(18);
    const out = tidySlide(lesson, sidOf(lesson), ruler);
    expect(out.outcome.continued).toBeGreaterThanOrEqual(2);
    const slides = out.lesson.slides;
    expect(slides.length).toBe(1 + out.outcome.continued);
    const lists = slides.map((s) =>
      bodies(s).find((b) => !docToPlainText(b.doc).startsWith("The ")),
    );
    const counts = lists.map((l) => (l ? docLineCount(l.doc) : 0));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(18);
    // Every continuation but the last is full: one more item would not fit on it.
    for (let i = 1; i < slides.length - 1; i++) {
      const s = slides[i];
      const l = lists[i];
      const nextFirst = lists[i + 1]?.doc.content?.[0];
      if (!s || !l || !nextFirst) throw new Error(`slide ${i}`);
      const fuller: Slide = {
        ...s,
        elements: s.elements.map((e) =>
          e.id === l.id && e.type === "text"
            ? { ...e, doc: { ...e.doc, content: [...(e.doc.content ?? []), nextFirst] } }
            : e,
        ),
      };
      expect(reflowSlide(fuller, theme, ruler).overflow.length).toBeGreaterThan(0);
      expect(reflowSlide(s, theme, ruler).overflow).toEqual([]);
    }
  });

  const workedExample = (question: string, steps: string[]) => {
    let n = 0;
    const slide = materialiseSlide(
      {
        kind: "worked-example",
        heading: "Share 24 sweets in the ratio 1:3",
        question,
        steps,
        factRefs: ["x1"],
      },
      "chalk",
      { promptVersion: "test", model: "test", at: "2026-09-25T00:00:00.000Z" },
      () => `e${++n}`,
    );
    const lesson = newLesson("W", "chalk");
    lesson.slides = [slide];
    return { lesson, slide };
  };
  const sevenSteps = [
    "Add the parts of the ratio: 1 + 3 = 4 parts in total.",
    "Divide the sweets by the parts: 24 divided by 4 = 6 each.",
    "One part is 6 sweets, so the first share is 1 x 6 = 6.",
    "Three parts are 3 x 6 = 18 sweets for the second share.",
    "Check the two shares add back to 24: 6 + 18 = 24.",
    "Check the ratio of the shares: 6:18 simplifies to 1:3.",
    "Write the answer as a sentence with both shares named.",
  ];
  const expectWorkingCard = (cont: Slide | undefined, from: number) => {
    expect(cont?.kind).toBe("worked-example");
    expect(cont?.elements.some((e) => e.type === "shape" && e.name === "Working card")).toBe(true);
    expect(
      cont?.elements.some(
        (e) =>
          e.type === "text" && e.style.preset === "caption" && docToPlainText(e.doc) === "WORKING",
      ),
    ).toBe(true);
    const carried = bodies(cont);
    expect(carried.length).toBe(1);
    const list = carried[0]?.doc.content?.[0];
    expect(list?.type).toBe("orderedList");
    expect(list?.attrs?.start ?? 1).toBe(from);
    expect(carried[0]?.revealStep).toBe(1);
  };

  test("AC3: a worked example with a six-line question continues its steps on a second card", () => {
    const question =
      "A bag holds 24 sweets. Ali and Bea share them in the ratio 1:3. Work out how many sweets each " +
      "of them gets, show every step of your working, and check your answer adds back to the total " +
      "before you write it down. Then explain in one sentence how you would share 36 sweets in the " +
      "same ratio without starting the whole calculation again from the beginning.";
    const { lesson, slide } = workedExample(question, sevenSteps);
    const out = tidySlide(lesson, slide.id, ruler);
    expect(out.outcome.continued).toBe(1);
    const [head, cont] = out.lesson.slides;
    // Six question lines push the card to the foot: not one step fits under them, so the whole
    // working, card and all, moves to the continuation and the head keeps the question alone.
    const headSteps = bodies(head).find((b) => b.doc.content?.[0]?.type === "orderedList");
    const kept = headSteps ? docLineCount(headSteps.doc) : 0;
    expect(head?.elements.some((e) => e.type === "shape" && e.name === "Working card")).toBe(
      kept > 0,
    );
    expectWorkingCard(cont, kept + 1);
    expect(docLineCount(bodies(cont)[0]?.doc ?? { type: "doc" })).toBe(7 - kept);
    const questionEl = bodies(head).find((b) => docToPlainText(b.doc).startsWith("A bag holds"));
    if (!questionEl) throw new Error("question");
    // The question stays on the head; if it still overruns it is the one box named.
    for (const id of out.outcome.overflow) expect(id).toBe(questionEl.id);
    expect(tidyMessage(out.outcome)).toContain("list continued on a new slide");
  });

  test("AC4: when only the steps overflow, the split is the same and nothing is left over", () => {
    const { lesson, slide } = workedExample("Share 24 sweets in the ratio 1:3.", sevenSteps);
    const out = tidySlide(lesson, slide.id, ruler);
    expect(out.outcome.continued).toBe(1);
    expect(out.outcome.overflow).toEqual([]);
    const [head, cont] = out.lesson.slides;
    const headSteps = bodies(head).find((b) => b.doc.content?.[0]?.type === "orderedList");
    if (!headSteps) throw new Error("head steps");
    expectWorkingCard(cont, docLineCount(headSteps.doc) + 1);
    expect(tidySlide(out.lesson, slide.id, ruler).outcome.changed).toBe(false);
  });

  test("a steps box grown past its card by editing still brings the card along", () => {
    const { lesson, slide } = workedExample("Share 24 sweets in the ratio 1:3.", sevenSteps);
    // Editing rewrites an auto-height box's stored height to its content: the steps now run past
    // the card they were laid on.
    slide.elements = slide.elements.map((e) =>
      e.type === "text" && e.doc.content?.[0]?.type === "orderedList" ? { ...e, h: 600 } : e,
    );
    const out = tidySlide(lesson, slide.id, ruler);
    expect(out.outcome.continued).toBe(1);
    const [head, cont] = out.lesson.slides;
    const headSteps = bodies(head).find((b) => b.doc.content?.[0]?.type === "orderedList");
    if (!headSteps) throw new Error("head steps");
    expectWorkingCard(cont, docLineCount(headSteps.doc) + 1);
  });

  test("AC5: a multiple-choice slide with long options is never continued (ruling 91)", () => {
    const lesson = newLesson("Q", "chalk");
    lesson.slides = [newSlide("multiple-choice", "chalk")];
    const slide = lesson.slides[0];
    if (!slide) throw new Error("slide");
    slide.elements = slide.elements.map((e) =>
      e.type === "option" ? { ...e, doc: docFromText(item(1) + item(2) + item(3)) } : e,
    );
    const out = tidySlide(lesson, slide.id, ruler);
    expect(out.outcome.continued).toBe(0);
    expect(out.lesson.slides.length).toBe(1);
  });

  test("AC6: the reducer leaves the input lesson untouched, so one undo step restores it", () => {
    const lesson = slideOf(6);
    const before = JSON.stringify(lesson);
    const out = tidySlideReducer(lesson, sidOf(lesson), ruler);
    expect(out.lesson).not.toBe(lesson);
    expect(out.lesson.slides.length).toBe(2);
    expect(JSON.stringify(lesson)).toBe(before);
  });

  // Greg's slide 4: heading, a rule, one AI paragraph that already runs off the slide, then six
  // teacher lines typed into the same box.
  const aiParagraph =
    "The Provisional Government continued the war, and every failed offensive cost it support in " +
    "the cities and at the front. It put off the land question until a Constituent Assembly could " +
    "meet, so peasants took the land themselves. Bread queues grew through the summer of 1917 as the " +
    "railways broke down, and the Kornilov affair left the government looking weak and the " +
    "Bolsheviks looking like the defenders of the revolution.";
  const teacherLines = Array.from(
    { length: 6 },
    (_, i) => `Teacher line ${i + 1}: discuss this with the class before moving on.`,
  );

  test("six typed lines under an AI paragraph go onto one continuation, not three thin ones", () => {
    const lesson = lessonOf([
      text("labh", 43, 87, "The Bolsheviks gained support as the Government lost it", "heading"),
      rule("labi", 329),
      text("labj", 371, 201, [aiParagraph, ...teacherLines].join("\n")),
    ]);
    const out = tidySlide(lesson, sidOf(lesson), ruler);
    expect(out.outcome.continued).toBeGreaterThanOrEqual(1);
    expect(out.outcome.continued).toBeLessThanOrEqual(2);
    expect(out.outcome.overflow).toEqual([]);
    const [head, cont, ...more] = out.lesson.slides;
    const headBody = byId(head, "labj");
    if (headBody?.type !== "text") throw new Error("head body");
    // The AI paragraph is cut at a sentence end where it stood, the rest goes on with the lines.
    const headText = docToPlainText(headBody.doc);
    expect(headText.startsWith("The Provisional Government")).toBe(true);
    expect(headText).toMatch(/[.!?]$/);
    const carried = bodies(cont);
    expect(carried.length).toBe(1);
    const tail = carried[0];
    if (!tail) throw new Error("tail");
    expect(tail.y).toBe(BODY_Y);
    const all = [cont, ...more].map((s) => docToPlainText(bodies(s)[0]?.doc ?? { type: "doc" }));
    expect(`${headText}\n${all.join("\n")}`.replace(/\s+/g, " ")).toBe(
      [aiParagraph, ...teacherLines].join(" "),
    );
    expect(headingOf(cont)).toBe(
      "The Bolsheviks gained support as the Government lost it (continued)",
    );
  });

  test("slide 4 as generated: the paragraph that ran off the slide continues at a sentence end", () => {
    const lesson = lessonOf([
      text("labh", 43, 87, "The Bolsheviks gained support as the Government lost it", "heading"),
      rule("labi", 329),
      text("labj", 371, 201, aiParagraph),
    ]);
    const out = tidySlide(lesson, sidOf(lesson), ruler);
    expect(out.outcome.continued).toBe(1);
    expect(out.outcome.overflow).toEqual([]);
    const [head, cont] = out.lesson.slides;
    const headBody = byId(head, "labj");
    if (headBody?.type !== "text") throw new Error("head body");
    const headText = docToPlainText(headBody.doc);
    expect(headText).toMatch(/[.!?]$/);
    const tailText = docToPlainText(bodies(cont)[0]?.doc ?? { type: "doc" });
    expect(`${headText} ${tailText}`).toBe(aiParagraph);
    expect(reflowSlide(head as Slide, theme, ruler).overflow).toEqual([]);
    expect(tidyMessage(out.outcome)).toBe("Tidied: list continued on a new slide");
  });

  test("a sentence split keeps marks and never leaves an empty run", () => {
    const lesson = lessonOf([
      text("h", 43, 60, "Marks", "heading"),
      {
        ...text("p", 140, 300, ""),
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: `${aiParagraph} `, marks: [{ type: "bold" }] },
                { type: "text", text: `${aiParagraph} ${aiParagraph}` },
              ],
            },
          ],
        },
      },
    ]);
    const out = tidySlide(lesson, sidOf(lesson), ruler);
    expect(out.outcome.continued).toBeGreaterThanOrEqual(1);
    for (const s of out.lesson.slides)
      for (const b of bodies(s))
        for (const run of b.doc.content?.[0]?.content ?? [])
          expect(run.text?.length).toBeGreaterThan(0);
    const headP = byId(out.lesson.slides[0], "p");
    if (headP?.type !== "text") throw new Error("head");
    expect(headP.doc.content?.[0]?.content?.[0]?.marks).toEqual([{ type: "bold" }]);
  });

  test("lines typed into the heading push the paragraph onto a continuation whole, under a one-line heading", () => {
    const heading = "The Bolsheviks gained support as the Government lost it";
    const lesson = lessonOf([
      text("labh", 43, 87, [heading, ...teacherLines].join("\n"), "heading"),
      rule("labi", 329),
      text("labj", 371, 201, aiParagraph),
    ]);
    const out = tidySlide(lesson, sidOf(lesson), ruler);
    expect(out.outcome.continued).toBe(1);
    const [head, cont] = out.lesson.slides;
    expect(byId(head, "labj")).toBeUndefined();
    expect(byId(head, "labh")).toBeDefined();
    const carried = bodies(cont);
    expect(carried.length).toBe(1);
    expect(docToPlainText(carried[0]?.doc ?? { type: "doc" })).toContain("Kornilov");
    expect(headingOf(cont)).toBe(`${heading} (continued)`);
    expect(out.outcome.overflow).toEqual([]);
    expect(reflowSlide(cont as Slide, theme, ruler).overflow).toEqual([]);
  });

  test("a lone paragraph taller than the slide is reported, never moved from slide to slide", () => {
    // One sentence, so there is no sentence end to cut at.
    const lesson = lessonOf([
      text("h", 43, 60, "One paragraph", "heading"),
      text("p", 140, 300, "and then another thing happened ".repeat(60).trim()),
    ]);
    const out = tidySlide(lesson, sidOf(lesson), ruler);
    expect(out.outcome.continued).toBe(0);
    expect(out.outcome.overflow).toEqual(["p"]);
    // The toast names the box by its first words, so the teacher knows which one it means.
    expect(out.outcome.overflowText).toEqual(["and then another thing happened\u2026"]);
    expect(tidyMessage(out.outcome)).toContain(
      '1 box will not fit at the smallest readable size ("and then another thing happened\u2026")',
    );
  });
});
