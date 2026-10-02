import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  type Lesson,
  parseLesson,
  type ShapeElement,
  type Slide,
  type SlideElement,
  type TextElement,
} from "@tj/domain/documents";
import { generatedFrom } from "@tj/domain/documents/fixtures";
import { BODY_Y, materialiseSlide, measureHeadless, SAFE, SAFE_BOTTOM } from "@tj/slides";
import { docFromText, newLesson, newSlide } from "../model/factories";
import { getTheme } from "../model/themes";
import { docToPlainText } from "../text/static";
import { lintSlide } from "./lint";
import { docLineCount, reflowSlide } from "./reflow";
import { rulerFor } from "./test-ruler";
import { CONTINUED_LABEL, tidyMessage, tidySlide, tidySlideReducer } from "./tidy";

/* `tidySlide` as a pure function over the lesson (TeachDeck's wrote the store). */

const theme = getTheme("chalk");
const isHeading = (e: SlideElement): boolean => e.type === "text" && e.style.preset === "heading";
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
  test("a divider struck through a heading that grew two lines is flagged, then moved below it", () => {
    const long = "A heading that runs well past a single line of the slide at the projector size";
    // Stored at the height its two lines need, so nothing overflows: only the rule is wrong.
    const heading = text("h", 43, 20, long, "heading");
    heading.h = ruler({
      doc: heading.doc,
      width: heading.w,
      style: heading.style,
      preset: "heading",
      inset: 0,
      chrome: 0,
    });
    const mid = heading.y + heading.h / 2;
    const rule: ShapeElement = {
      id: "rule",
      type: "shape",
      shape: "rect",
      x: 58,
      y: mid,
      w: 844,
      h: 1,
    };
    const body = text("b", heading.y + heading.h + 20, 0, "Body copy.");
    body.h = ruler({
      doc: body.doc,
      width: body.w,
      style: body.style,
      preset: "body",
      inset: 0,
      chrome: 0,
    });
    const lesson = lessonWith([heading, body]);
    const slide = lesson.slides[0];
    if (!slide) throw new Error("seed");
    slide.elements = [slide.elements[0] as SlideElement, rule, slide.elements[1] as SlideElement];
    // Nothing else is wrong on the slide, so the fit migration tidies it only if the rule counts.
    expect(lintSlide(slide, ruler).overlaps).toEqual([["h", "rule"]]);
    const out = tidySlide(lesson, slide.id, ruler);
    const els = out.lesson.slides[0]?.elements ?? [];
    const h = els.find((el) => el.id === "h");
    const r = els.find((el) => el.id === "rule");
    expect(h && r && r.y >= h.y + h.h - 4).toBe(true);
    expect(lintSlide(out.lesson.slides[0] as never, ruler).overlaps).toEqual([]);
  });

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
    expect(docToPlainText((heading as TextElement).doc)).toBe("Learning objectives");
    expect(out.lesson.slides.at(-1)?.elements.some((e) => e.name === CONTINUED_LABEL)).toBe(true);
    expect(tidyMessage(out.outcome)).toContain("continued on");
  });

  test("TEACH-248: a continuation keeps its heading's words and size under a CONTINUED label", () => {
    const items = Array.from(
      { length: 40 },
      (_, i) => `Item number ${i + 1} on this very long list of things`,
    );
    const lesson = lessonWith([
      text("h", SAFE.y, 60, "Learning objectives", "heading"),
      text("list", 120, 300, items.join("\n")),
    ]);
    const sid = lesson.slides[0]?.id ?? "";
    const out = tidySlide(lesson, sid, ruler);
    const [head, ...conts] = out.lesson.slides.slice(0, 1 + out.outcome.continued);
    expect(conts.length).toBeGreaterThanOrEqual(2);
    const headHeading = head?.elements.find((e) => e.name !== CONTINUED_LABEL && isHeading(e));
    expect(head?.elements.some((e) => e.name === CONTINUED_LABEL)).toBe(false);
    const contHeadingY = new Set<number>();
    for (const cont of conts) {
      const heading = cont.elements.find(isHeading) as TextElement;
      const label = cont.elements.find((e) => e.name === CONTINUED_LABEL) as TextElement;
      expect(docToPlainText(heading.doc)).toBe("Learning objectives");
      expect(heading.style.fontSize).toBe((headHeading as TextElement).style.fontSize);
      expect(docToPlainText(label.doc)).toBe("CONTINUED");
      // The label takes the top margin a heading has on an ordinary slide; the heading moves down.
      expect(label.y).toBe(SAFE.y);
      expect(heading.y).toBeGreaterThanOrEqual(label.y + label.h);
      contHeadingY.add(heading.y);
      // Every continuation carries body text, clear of the heading, and fits.
      const body = cont.elements.filter((e) => e.type === "text" && e.style.preset === "body");
      expect(body.length).toBeGreaterThan(0);
      for (const b of body) expect(b.y).toBeGreaterThanOrEqual(heading.y + heading.h);
      const rule = cont.elements.find((e) => e.type === "shape" && e.h === 1);
      if (rule) {
        expect(rule.y).toBeGreaterThan(heading.y + heading.h);
        expect(rule.y).toBeLessThan(Math.min(...body.map((b) => b.y)));
      }
      expect(reflowSlide(cont, theme, ruler).overflow).toEqual([]);
    }
    // One label, one heading position, down the whole chain.
    expect(contHeadingY.size).toBe(1);
    for (const cont of conts)
      expect(cont.elements.filter((e) => e.name === CONTINUED_LABEL)).toHaveLength(1);
  });

  test("TEACH-248: tidying a continuation again adds no second label and moves nothing", () => {
    const items = Array.from({ length: 24 }, (_, i) => `Point ${i + 1} about the topic at hand`);
    const lesson = lessonWith([
      text("h", SAFE.y, 60, "Coastal management", "heading"),
      text("list", 120, 300, items.join("\n")),
    ]);
    const first = tidySlide(lesson, lesson.slides[0]?.id ?? "", ruler).lesson;
    const cont = first.slides[1];
    expect(cont?.elements.some((e) => e.name === CONTINUED_LABEL)).toBe(true);
    const again = tidySlide(first, cont?.id ?? "", ruler);
    expect(again.outcome.changed).toBe(false);
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

describe("split: false (a generated slide gets no continuation)", () => {
  const items = Array.from(
    { length: 40 },
    (_, i) => `Item number ${i + 1} on this very long list of things`,
  );
  const aiText = (el: TextElement): TextElement => ({
    ...el,
    generatedFrom: generatedFrom(["o1"]),
    authoredBy: "ai",
  });

  test("a generated slide is reflowed but never continued, and what will not fit is reported", () => {
    const lesson = lessonWith([
      aiText(text("h", 43, 60, "Learning objectives", "heading")),
      aiText(text("list", 120, 300, items.join("\n"))),
    ]);
    const sid = lesson.slides[0]?.id ?? "";
    const out = tidySlide(lesson, sid, ruler);
    expect(out.outcome.continued).toBe(0);
    expect(out.lesson.slides).toHaveLength(lesson.slides.length);
    expect(out.outcome.overflow).toContain("list");
    // Every word stays on the slide: nothing is cut or carried.
    const list = out.lesson.slides[0]?.elements.find((e) => e.id === "list") as TextElement;
    expect(docToPlainText(list.doc)).toBe(docToPlainText(docFromText(items.join("\n"))));
  });

  test("the same slide once a teacher has edited it still continues", () => {
    const heading = aiText(text("h", 43, 60, "Learning objectives", "heading"));
    const list = {
      ...aiText(text("list", 120, 300, items.join("\n"))),
      authoredBy: "teacher" as const,
    };
    const lesson = lessonWith([heading, list]);
    const out = tidySlide(lesson, lesson.slides[0]?.id ?? "", ruler);
    expect(out.outcome.continued).toBeGreaterThanOrEqual(1);
  });

  test("split: false holds for a teacher's slide too when asked, and split: true overrides", () => {
    const plain = lessonWith([
      text("h", 43, 60, "Learning objectives", "heading"),
      text("list", 120, 300, items.join("\n")),
    ]);
    const sid = plain.slides[0]?.id ?? "";
    expect(tidySlide(plain, sid, ruler, { split: false }).outcome.continued).toBe(0);
    const generated = lessonWith([
      aiText(text("h", 43, 60, "Learning objectives", "heading")),
      aiText(text("list", 120, 300, items.join("\n"))),
    ]);
    const gid = generated.slides[0]?.id ?? "";
    expect(tidySlide(generated, gid, ruler, SPLIT).outcome.continued).toBeGreaterThanOrEqual(1);
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

/*
 * The split engine on recipe-laid slides. A materialised slide is a generated one, which Tidy
 * never splits by default, since generation saves it fitted; these hold the engine itself,
 * as it runs for a teacher's slide.
 */
const SPLIT = { split: true } as const;

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
    expect(headingOf(cont)).toBe("Why the Bolsheviks gained support");
    expect(cont?.elements.some((e) => e.name === CONTINUED_LABEL)).toBe(true);
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
    // Filled greedily: every continuation but the last holds the same number of items (the
    // capacity), the last the remainder, and there are exactly as many as that needs.
    const capacity = counts[1] ?? 0;
    expect(capacity).toBeGreaterThan(1);
    for (let i = 1; i < slides.length - 1; i++) expect(counts[i]).toBe(capacity);
    expect(counts[slides.length - 1]).toBeLessThanOrEqual(capacity);
    expect(out.outcome.continued).toBe(Math.ceil((18 - (counts[0] ?? 0)) / capacity));
    // The heading is the same size, and the same height, on every slide of the chain.
    const headings = slides.map((s) =>
      s.elements.find((e) => e.type === "text" && e.style.preset === "heading"),
    );
    const sizes = new Set(headings.map((h) => (h?.type === "text" ? h.style.fontSize : -1)));
    expect(sizes.size).toBe(1);
    expect(new Set(headings.map((h) => h?.h)).size).toBe(1);
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
    const out = tidySlide(lesson, slide.id, ruler, SPLIT);
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
    const out = tidySlide(lesson, slide.id, ruler, SPLIT);
    expect(out.outcome.continued).toBe(1);
    expect(out.outcome.overflow).toEqual([]);
    const [head, cont] = out.lesson.slides;
    const headSteps = bodies(head).find((b) => b.doc.content?.[0]?.type === "orderedList");
    if (!headSteps) throw new Error("head steps");
    expectWorkingCard(cont, docLineCount(headSteps.doc) + 1);
    expect(tidySlide(out.lesson, slide.id, ruler, SPLIT).outcome.changed).toBe(false);
  });

  describe("continuation text takes the full safe width (ruling 102, T18-6)", () => {
    const picture: SlideElement = {
      id: "pic",
      type: "image",
      x: 58,
      y: 140,
      w: 400,
      h: 300,
      src: "x",
      fit: "cover",
    };
    const beside = (id: string, y: number, words: string): TextElement => ({
      ...text(id, y, 200, words),
      x: 482,
      w: 420,
    });

    test("a list beside a picture continues across the whole safe area; the head keeps its column", () => {
      const lesson = lessonOf([
        text("h", 43, 60, "Why the Bolsheviks gained support", "heading"),
        picture,
        beside("list", 140, items(5).join("\n")),
      ]);
      const out = tidySlide(lesson, sidOf(lesson), ruler);
      expect(out.outcome.continued).toBe(1);
      const [head, cont] = out.lesson.slides;
      expect(byId(head, "list")).toMatchObject({ x: 482, w: 420 });
      const tail = bodies(cont)[0];
      if (tail?.type !== "text") throw new Error("tail");
      expect(tail).toMatchObject({ x: SAFE.x, w: SAFE.w });
      // The picture stays on the head; nothing on the continuation stands beside the list.
      expect(cont?.elements.some((e) => e.type === "image")).toBe(false);
      // Its height is the tail's at the full width, not at the column's.
      const measured = (width: number) =>
        ruler({ doc: tail.doc, width, preset: "body", style: tail.style, inset: 0, chrome: 0 });
      expect(tail.h).toBeLessThan(measured(420) / 2);
    });

    test("a box moved whole from beside a picture is widened and re-measured", () => {
      const lesson = lessonOf([
        text("h", 43, 60, "Why the Bolsheviks gained support", "heading"),
        picture,
        beside("p", 140, para),
        beside("q", 470, para),
      ]);
      const out = tidySlide(lesson, sidOf(lesson), ruler);
      expect(out.outcome.continued).toBe(1);
      const moved = bodies(out.lesson.slides[1])[0];
      if (!moved) throw new Error("moved");
      expect(moved).toMatchObject({ x: SAFE.x, w: SAFE.w });
      expect(byId(out.lesson.slides[0], "p")).toMatchObject({ x: 482, w: 420 });
    });

    test("a worked example's card and steps keep their widths on the continuation", () => {
      const { lesson, slide } = workedExample("Share 24 sweets in the ratio 1:3.", sevenSteps);
      const out = tidySlide(lesson, slide.id, ruler);
      const cont = out.lesson.slides[1];
      for (const el of cont?.elements ?? []) {
        const authored = slide.elements.find((e) => e.id === el.id);
        if (authored && el.type !== "text") expect(el.w).toBe(authored.w);
        if (authored && el.type === "text" && el.style.preset === "body")
          expect({ x: el.x, w: el.w }).toEqual({ x: authored.x, w: authored.w });
      }
    });
  });

  test("a generated slide's continuation keeps its frame and sets the body under the heading, full width", () => {
    // Stored lesson "Animals and their young" (E49, Y1 science), slide 6: a body beside the diagram
    // zone, under a kind tag and deck line; the teacher adds three sentences as paragraphs.
    const fixture = JSON.parse(
      readFileSync(new URL("./fixtures/animals-diagram.slide.json", import.meta.url), "utf8"),
    ) as { themeId: string; slide: Slide };
    const lesson = newLesson("Animals", fixture.themeId);
    lesson.slides = [fixture.slide];
    const animals = parseLesson(lesson);
    const source = animals.slides[0] as Slide;
    const body = source.elements.find((e) => e.name === "Body");
    if (body?.type !== "text") throw new Error("fixture");
    const added = docFromText(
      [
        "A duckling hatches from an egg covered in soft down, and grows feathers before it can swim far.",
        "A lamb is born able to stand, and it drinks its mother's milk until it can eat grass.",
        "A caterpillar eats leaves, makes a chrysalis, and comes out as a butterfly with wings.",
      ].join("\n"),
    );
    body.doc = { type: "doc", content: [...(body.doc.content ?? []), ...(added.content ?? [])] };
    // The teacher's edit flips the body to teacher-authored in the editor; mark it so here.
    body.authoredBy = "teacher";
    const out = tidySlide(animals, source.id, measureHeadless(getTheme(animals.themeId)));
    expect(out.outcome.continued).toBe(1);
    const [head, cont] = out.lesson.slides;
    const names = (s: Slide | undefined) => (s?.elements ?? []).map((e) => e.name);
    for (const frame of ["Kind tag", "Deck line", "Accent bar"])
      expect(names(cont)).toContain(frame);
    expect(names(cont)).not.toContain("Diagram placeholder");
    const heading = cont?.elements.find((e) => e.name === "Heading");
    const tail = cont?.elements.find((e) => e.name === "Body");
    if (!heading || tail?.type !== "text") throw new Error("continuation");
    expect(tail.y).toBeGreaterThanOrEqual(heading.y + heading.h);
    expect(tail).toMatchObject({ x: SAFE.x, w: SAFE.w });
    expect(head?.elements.find((e) => e.name === "Body")).toMatchObject({ x: body.x, w: body.w });
  });

  test("a steps box grown past its card by editing still brings the card along", () => {
    const { lesson, slide } = workedExample("Share 24 sweets in the ratio 1:3.", sevenSteps);
    // Editing rewrites an auto-height box's stored height to its content: the steps now run past
    // the card they were laid on.
    slide.elements = slide.elements.map((e) =>
      e.type === "text" && e.doc.content?.[0]?.type === "orderedList" ? { ...e, h: 600 } : e,
    );
    const out = tidySlide(lesson, slide.id, ruler, SPLIT);
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
    // The head is re-stacked from the top: no gap is left where the lines used to be.
    expect(headBody.y).toBe(BODY_Y);
    const carried = bodies(cont);
    expect(carried.length).toBe(1);
    const tail = carried[0];
    if (!tail) throw new Error("tail");
    // Straight under the heading band: the "(continued)" heading wraps, so its rule sits lower.
    const contRule = cont?.elements.find((e) => e.type === "shape" && e.h === 1);
    expect(tail.y).toBeGreaterThanOrEqual(BODY_Y);
    expect(tail.y - ((contRule?.y ?? BODY_Y) + 1)).toBeLessThanOrEqual(49);
    const all = [cont, ...more].map((s) => docToPlainText(bodies(s)[0]?.doc ?? { type: "doc" }));
    expect(`${headText}\n${all.join("\n")}`.replace(/\s+/g, " ")).toBe(
      [aiParagraph, ...teacherLines].join(" "),
    );
    expect(cont?.elements.some((e) => e.name === CONTINUED_LABEL)).toBe(true);
    expect(headingOf(cont)).toBe("The Bolsheviks gained support as the Government lost it");
  });

  test("slide 4 as generated: the paragraph that ran off the slide is lifted to the body top and fits", () => {
    const lesson = lessonOf([
      text("labh", 43, 87, "The Bolsheviks gained support as the Government lost it", "heading"),
      rule("labi", 329),
      text("labj", 371, 201, aiParagraph),
    ]);
    const out = tidySlide(lesson, sidOf(lesson), ruler);
    expect(out.outcome.continued).toBe(0);
    expect(out.outcome.overflow).toEqual([]);
    const head = out.lesson.slides[0];
    const headBody = byId(head, "labj");
    if (headBody?.type !== "text") throw new Error("head body");
    expect(headBody.y).toBe(BODY_Y);
    expect(docToPlainText(headBody.doc)).toBe(aiParagraph);
    const ruleEl = byId(head, "labi");
    expect((ruleEl?.y ?? 0) < BODY_Y).toBe(true);
    expect(reflowSlide(head as Slide, theme, ruler).overflow).toEqual([]);
  });

  test("a paragraph too long for the lifted head continues at a sentence end", () => {
    const lesson = lessonOf([
      text("labh", 43, 87, "The Bolsheviks gained support as the Government lost it", "heading"),
      rule("labi", 329),
      text("labj", 371, 201, `${aiParagraph} ${aiParagraph}`),
    ]);
    const out = tidySlide(lesson, sidOf(lesson), ruler);
    expect(out.outcome.continued).toBe(1);
    expect(out.outcome.overflow).toEqual([]);
    const [head, cont] = out.lesson.slides;
    const headBody = byId(head, "labj");
    if (headBody?.type !== "text") throw new Error("head body");
    const headText = docToPlainText(headBody.doc);
    expect(headText).toMatch(/[.!?]$/);
    expect(headBody.y).toBe(BODY_Y);
    const tailText = docToPlainText(bodies(cont)[0]?.doc ?? { type: "doc" });
    expect(`${headText} ${tailText}`).toBe(`${aiParagraph} ${aiParagraph}`);
    expect(tidyMessage(out.outcome)).toContain("list continued on a new slide");
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
    expect(byId(head, "labh")).toBeDefined();
    const carried = bodies(cont);
    expect(carried.length).toBe(1);
    const tailText = docToPlainText(carried[0]?.doc ?? { type: "doc" });
    expect(tailText).toContain("Kornilov");
    // What stays behind (if anything) ends at a sentence end, and nothing is lost.
    const left = byId(head, "labj");
    const headText = left?.type === "text" ? docToPlainText(left.doc) : "";
    if (headText) expect(headText).toMatch(/[.!?]$/);
    expect([headText, tailText].filter(Boolean).join(" ")).toBe(aiParagraph);
    expect(headingOf(cont)).toBe(heading);
    expect(cont?.elements.some((e) => e.name === CONTINUED_LABEL)).toBe(true);
    // The heading rule sits under the one-line heading on the continuation, above the paragraph.
    const contRule = cont?.elements.find((e) => e.type === "shape" && e.h === 1);
    expect((contRule?.y ?? 0) < (carried[0]?.y ?? 0)).toBe(true);
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

  test("a stored worked example whose steps run off their card continues with the card (Freud, slide 9)", () => {
    // As generated (E49, Y13 psychology): four steps at the 26pt body floor, three of them two
    // lines long, drawn 309 tall from y 308 on a 540 slide; the card stops at 515.
    const fixture = JSON.parse(
      readFileSync(new URL("./fixtures/freud-worked-example.slide.json", import.meta.url), "utf8"),
    ) as { themeId: string; slide: Slide };
    const lesson = newLesson("Freud", fixture.themeId);
    lesson.slides = [fixture.slide];
    const freud = parseLesson(lesson);
    const source = freud.slides[0] as Slide;
    const measure = measureHeadless(getTheme(freud.themeId));
    const card = source.elements.find((e) => e.type === "shape" && e.name === "Working card");
    const steps = source.elements.find((e) => e.type === "text" && e.revealStep === 1);
    const question = source.elements.find(
      (e) => e.type === "text" && e.style.preset === "body" && e.revealStep === undefined,
    );
    if (!card || steps?.type !== "text" || !question) throw new Error("fixture");

    // The engine names the card first (it overflows too, and sits above the steps): the split has
    // to look past it to the steps laid on it.
    const reflowed = reflowSlide(source, getTheme(freud.themeId), measure);
    expect(source.elements[reflowed.splitAt ?? -1]?.id).toBe(card.id);
    expect(reflowed.overflow).toContain(steps.id);

    const out = tidySlide(freud, source.id, measure, { split: true });
    expect(out.outcome.continued).toBe(1);
    expect(out.outcome.overflow).toEqual([]);
    expect(tidyMessage(out.outcome)).toContain("list continued on a new slide");
    const [head, cont] = out.lesson.slides;
    if (!head || !cont) throw new Error("slides");

    // The head keeps the question and the first steps on its card, all inside the safe area.
    const headSteps = byId(head, steps.id);
    expect(byId(head, question.id)).toBeDefined();
    expect(headSteps?.type === "text" ? docLineCount(headSteps.doc) : 0).toBe(2);
    for (const el of head.elements) expect(el.y + el.h).toBeLessThanOrEqual(SAFE_BOTTOM + 0.5);

    // The continuation is a worked example with the card, its caption and steps 3 and 4 numbered
    // on, the reveal kept; no question on it.
    expect(cont.kind).toBe("worked-example");
    expect(cont.elements.some((e) => e.type === "shape" && e.name === "Working card")).toBe(true);
    expect(
      cont.elements.some((e) => e.type === "text" && docToPlainText(e.doc) === "WORKING"),
    ).toBe(true);
    const texts = cont.elements.flatMap((e) => (e.type === "text" ? [docToPlainText(e.doc)] : []));
    expect(texts.some((t) => t.includes("explain this avoidance?"))).toBe(false);
    const carried = cont.elements.find((e) => e.type === "text" && e.revealStep === 1);
    if (carried?.type !== "text") throw new Error("carried steps");
    const list = carried.doc.content?.[0];
    expect(list?.type).toBe("orderedList");
    expect(list?.attrs?.start).toBe(3);
    expect(docLineCount(carried.doc)).toBe(2);
    expect(carried.reveal).toBe("rise");
    expect(cont?.elements.some((e) => e.name === CONTINUED_LABEL)).toBe(true);
    expect(reflowSlide(cont, getTheme(freud.themeId), measure).overflow).toEqual([]);
  });
});
