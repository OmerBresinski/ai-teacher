import { describe, expect, it } from "bun:test";
import type {
  GapTextElement,
  Lesson,
  OptionElement,
  Slide,
  SlideElement,
  TextElement,
} from "@tj/domain/documents";
import { SLIDE_H, SLIDE_W } from "@tj/domain/documents";
import JSZip from "jszip";
import { newSlide } from "../model/factories";
import { demoLibrary } from "../model/starter";
import { getTheme } from "../model/themes";
import { resolveTextStyle } from "../slide/elements/kit";
import { imageCredentials } from "./image-credentials";
import {
  answerText,
  buildSlidePlan,
  exportLessonPptx,
  fontFaceFor,
  formatClock,
  gapTextToBlanks,
  hexColor,
  inches,
  LAYOUT_H_IN,
  LAYOUT_W_IN,
  lessonAnswers,
  maxRevealStep,
  paragraphsToTextProps,
  place,
  pptxDashType,
  pptxFilename,
  pptxShapeName,
  slideLabel,
  textBoxOptions,
  trackingToPt,
} from "./pptx";
import { docToRuns } from "./runs";

/*
 * TeachDeck `lib/export/__tests__/pptx.test.ts` restated (TEACH-111 rows 1, 3), plus the revealed
 * badge (row 4) and the image credentials rule (TEACH-272 §1). pptxgenjs writes real files under
 * Bun; the OOXML cases read `ppt/slides/*.xml` back through jszip.
 */

const theme = getTheme("chalk");

const doc = (content: unknown[]) => ({ type: "doc" as const, content: content as never });
const text = (value: string, marks?: unknown[]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const para = (content: unknown[]) => ({ type: "paragraph", content });

const slide = (elements: SlideElement[], extra: Partial<Slide> = {}): Slide => ({
  id: "s1",
  kind: "content",
  elements,
  ...extra,
});

const textElement = (over: Partial<TextElement> = {}): TextElement => ({
  id: "t1",
  type: "text",
  x: 96,
  y: 72,
  w: 768,
  h: 120,
  doc: doc([para([text("Hello")])]),
  style: { preset: "body" },
  ...over,
});

/* ------------------------------------------------------------------ */

describe("units and layout", () => {
  it("makes one slide point exactly one PowerPoint point", () => {
    expect(LAYOUT_W_IN * 72).toBeCloseTo(SLIDE_W, 6);
    expect(LAYOUT_H_IN * 72).toBeCloseTo(SLIDE_H, 6);
    expect(inches(72)).toBe(1);
    expect(inches(SLIDE_W)).toBeCloseTo(13.3333, 4);
  });
});

describe("hexColor", () => {
  it("reads six and three digit hex", () => {
    expect(hexColor("#A94A18")).toBe("A94A18");
    expect(hexColor("#fff")).toBe("FFFFFF");
  });

  it("reads rgb and rgba, ignoring the alpha", () => {
    expect(hexColor("rgb(42 70 184 / 0.5)")).toBe("2A46B8");
    expect(hexColor("rgba(255, 0, 0, 0.2)")).toBe("FF0000");
  });

  it("returns undefined for anything PowerPoint cannot use", () => {
    expect(hexColor(undefined)).toBeUndefined();
    expect(hexColor("currentColor")).toBeUndefined();
    expect(hexColor("linear-gradient(#fff, #000)")).toBeUndefined();
  });
});

describe("fontFaceFor", () => {
  it("maps every theme font stack to a real family name", () => {
    expect(fontFaceFor(theme.fonts.body)).toBe("Lexend");
    expect(fontFaceFor(getTheme("reading-room").fonts.title)).toBe("Source Serif 4");
    expect(fontFaceFor(getTheme("beacon").fonts.body)).toBe("Atkinson Hyperlegible Next");
    expect(fontFaceFor(getTheme("night-lab").fonts.title)).toBe("Bricolage Grotesque");
  });

  it("falls back to the first real family, then to Arial", () => {
    expect(fontFaceFor('var(--font-unknown), "Trebuchet MS", sans-serif')).toBe("Trebuchet MS");
    expect(fontFaceFor("sans-serif")).toBe("Arial");
    expect(fontFaceFor(undefined)).toBe("Arial");
  });
});

describe("trackingToPt", () => {
  it("converts em tracking at the run size", () => {
    expect(trackingToPt("-0.01em", 52)).toBe(-0.52);
    expect(trackingToPt("0.08em", 25)).toBe(2);
  });

  it("ignores nothing, zero and non-em units", () => {
    expect(trackingToPt("normal", 24)).toBeUndefined();
    expect(trackingToPt("0em", 24)).toBeUndefined();
    expect(trackingToPt("2px", 24)).toBeUndefined();
  });
});

describe("shape and line mapping", () => {
  it("maps every shape kind to a native PowerPoint shape", () => {
    expect(pptxShapeName("rect")).toBe("rect");
    expect(pptxShapeName("rounded")).toBe("roundRect");
    expect(pptxShapeName("pill")).toBe("roundRect");
    expect(pptxShapeName("ellipse")).toBe("ellipse");
    expect(pptxShapeName("triangle")).toBe("triangle");
    expect(pptxShapeName("diamond")).toBe("diamond");
    expect(pptxShapeName("star")).toBe("star5");
    expect(pptxShapeName("speech")).toBe("wedgeRoundRectCallout");
  });

  it("maps dashes", () => {
    expect(pptxDashType("solid")).toBe("solid");
    expect(pptxDashType("dashed")).toBe("dash");
    expect(pptxDashType("dotted")).toBe("sysDot");
    expect(pptxDashType(undefined)).toBe("solid");
  });
});

describe("paragraphsToTextProps", () => {
  const style = { fontFace: "Lexend", fontSize: 24, color: "2C2A24" };

  it("emits one entry per run and breaks every line but the last", () => {
    const props = paragraphsToTextProps(
      docToRuns(doc([para([text("one")]), para([text("two")])])),
      style,
    );
    expect(props.map((p) => p.text)).toEqual(["one", "two"]);
    expect(props[0]?.options?.breakLine).toBe(true);
    expect(props[1]?.options?.breakLine).toBe(false);
  });

  it("carries marks through to PowerPoint run properties", () => {
    const props = paragraphsToTextProps(
      docToRuns(
        doc([para([text("bold", [{ type: "bold" }]), text("under", [{ type: "underline" }])])]),
      ),
      style,
    );
    expect(props[0]?.options?.bold).toBe(true);
    expect(props[1]?.options?.underline).toEqual({ style: "sng" });
  });

  it("exports a link as a PowerPoint run hyperlink", () => {
    const props = paragraphsToTextProps(
      docToRuns(
        doc([
          para([
            text("Bitesize", [{ type: "link", attrs: { href: "https://bbc.co.uk/bitesize" } }]),
          ]),
        ]),
      ),
      style,
    );
    expect(props[0]?.options?.hyperlink).toEqual({ url: "https://bbc.co.uk/bitesize" });
  });

  it("leaves plain text without a hyperlink", () => {
    const props = paragraphsToTextProps(docToRuns(doc([para([text("plain")])])), style);
    expect(props[0]?.options?.hyperlink).toBeUndefined();
  });

  it("prefers the run colour over the element colour", () => {
    const props = paragraphsToTextProps(
      docToRuns(doc([para([text("x", [{ type: "textStyle", attrs: { color: "#A94A18" } }])])])),
      style,
    );
    expect(props[0]?.options?.color).toBe("A94A18");
  });

  it("turns lists into bullets and numbers on every run of the line", () => {
    const list = {
      type: "orderedList",
      content: [{ type: "listItem", content: [para([text("Divide by the denominator")])] }],
    };
    const props = paragraphsToTextProps(docToRuns(doc([list])), style);
    expect(props[0]?.options?.bullet).toEqual({ type: "number" });

    const bullets = {
      type: "bulletList",
      content: [{ type: "listItem", content: [para([text("a")])] }],
    };
    expect(paragraphsToTextProps(docToRuns(doc([bullets])), style)[0]?.options?.bullet).toBe(true);
  });

  it("uppercases only when the preset asks for it", () => {
    const runs = docToRuns(doc([para([text("science")])]));
    expect(paragraphsToTextProps(runs, { ...style, uppercase: true })[0]?.text).toBe("SCIENCE");
    expect(paragraphsToTextProps(runs, style)[0]?.text).toBe("science");
  });

  it("marks a hard break as a soft break, once", () => {
    const props = paragraphsToTextProps(
      docToRuns(
        doc([
          para([text("one"), { type: "hardBreak" }, text("two"), text("!", [{ type: "bold" }])]),
        ]),
      ),
      style,
    );
    expect(props[1]?.options?.softBreakBefore).toBe(true);
    expect(props[2]?.options?.softBreakBefore).toBeUndefined();
  });

  it("never returns an empty array, so addText always has something to write", () => {
    expect(paragraphsToTextProps([], style)).toHaveLength(1);
  });
});

describe("textBoxOptions", () => {
  it("positions in inches and keeps padding and line height in points", () => {
    const element = textElement({ style: { preset: "body", padding: 12 } });
    const options = textBoxOptions(element, resolveTextStyle(element.style, theme));
    expect(options.x).toBeCloseTo(96 / 72, 6);
    expect(options.w).toBeCloseTo(768 / 72, 6);
    expect(options.margin).toBe(12);
    expect(options.lineSpacingMultiple).toBe(theme.lineHeights.body);
    expect(options.isTextBox).toBe(true);
  });

  it("rounds a rotated, filled box into a PowerPoint rounded rectangle", () => {
    const element = textElement({
      rotation: 12,
      style: { preset: "body", background: "#FFFBF0", radius: 14 },
    });
    const options = textBoxOptions(element, resolveTextStyle(element.style, theme));
    expect(options.rotate).toBe(12);
    expect(options.fill).toEqual({ color: "FFFBF0" });
    expect(options.shape).toBe("roundRect");
    expect(options.rectRadius).toBeCloseTo(14 / 72, 6);
  });

  it("turns element opacity into PowerPoint transparency", () => {
    const options = textBoxOptions(
      textElement({ opacity: 0.4 }),
      resolveTextStyle({ preset: "body" }, theme),
    );
    expect(options.transparency).toBe(60);
  });
});

describe("reveal steps", () => {
  it("is one slide when nothing reveals", () => {
    const lesson = { slides: [slide([textElement()])] } as Lesson;
    expect(maxRevealStep(lesson.slides[0] as Slide)).toBe(0);
    expect(buildSlidePlan(lesson)).toHaveLength(1);
  });

  it("emits one build slide per step, each carrying the steps before it", () => {
    const lesson = {
      slides: [
        slide([
          textElement({ id: "a" }),
          textElement({ id: "b", revealStep: 1 }),
          textElement({ id: "c", revealStep: 2 }),
        ]),
      ],
    } as Lesson;
    expect(buildSlidePlan(lesson).map((b) => b.step)).toEqual([0, 1, 2]);
    expect(buildSlidePlan(lesson).every((b) => b.steps === 3)).toBe(true);
  });

  it("sees reveal steps inside a group", () => {
    const group: SlideElement = {
      id: "g",
      type: "group",
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      children: [textElement({ id: "child", revealStep: 3 })],
    };
    expect(maxRevealStep(slide([group]))).toBe(3);
  });

  it("does not add a step for the question answer reveal", () => {
    const question = slide([textElement()], { question: { type: "true-false", correct: true } });
    expect(buildSlidePlan({ slides: [question] } as Lesson)).toHaveLength(1);
  });
});

describe("answers", () => {
  it("reads a true/false answer with its explanation", () => {
    const s = slide([textElement()], {
      question: { type: "true-false", correct: false, explanation: "Clouds are droplets." },
    });
    expect(answerText(s)).toBe("False. Clouds are droplets.");
  });

  it("reads the correct multiple-choice option text", () => {
    const option: SlideElement = {
      id: "o1",
      type: "option",
      x: 0,
      y: 0,
      w: 100,
      h: 40,
      doc: doc([para([text("12")])]),
    };
    const s = slide([option], {
      question: {
        type: "multiple-choice",
        options: [
          { id: "o1", correct: true },
          { id: "o2", correct: false },
        ],
      },
    });
    expect(answerText(s)).toBe("12");
  });

  it("numbers gap answers and returns null when there is no question", () => {
    const s = slide([], {
      question: {
        type: "fill-gap",
        gaps: [
          { id: "g1", answer: "evaporation" },
          { id: "g2", answer: "gas" },
        ],
      },
    });
    expect(answerText(s)).toBe("1. evaporation   2. gas");
    expect(answerText(slide([]))).toBeNull();
  });

  it("pairs an image-match picture with the word that belongs under it", () => {
    const picture: SlideElement = {
      id: "i1",
      type: "image",
      x: 0,
      y: 0,
      w: 200,
      h: 120,
      src: "data:,",
      fit: "cover",
      name: "Picture 1",
    };
    const word = textElement({ id: "w1", doc: doc([para([text("Water")])]) });
    const s = slide([picture, word], {
      question: { type: "image-match", pairs: [{ id: "p1", imageId: "i1", labelId: "w1" }] },
    });
    expect(answerText(s)).toBe("Picture 1 → Water");
  });

  it("labels a slide by its first text, numbered from one", () => {
    expect(
      slideLabel(slide([textElement({ doc: doc([para([text("Clouds are water vapour.")])]) })]), 5),
    ).toBe("Slide 6. Clouds are water vapour.");
    expect(slideLabel(slide([]), 0)).toBe("Slide 1");
  });

  it("collects every question in the demo lessons", () => {
    const [water, fractions] = demoLibrary();
    if (!water || !fractions) throw new Error("fixture");
    expect(lessonAnswers(water).map((a) => a.answer)).toEqual([
      "False. Clouds are tiny droplets of liquid water. Water vapour is invisible.",
    ]);
    expect(lessonAnswers(fractions)).toHaveLength(1);
  });
});

describe("gap text", () => {
  it("hides the answer behind a rule as long as the word", () => {
    const element: GapTextElement = {
      id: "g",
      type: "gap-text",
      x: 0,
      y: 0,
      w: 400,
      h: 100,
      doc: doc([para([text("Water turns to [[gap:g1]] when heated.")])]),
      style: { preset: "body" },
    };
    const [paragraph] = gapTextToBlanks(element, {
      type: "fill-gap",
      gaps: [{ id: "g1", answer: "vapour" }],
    });
    expect(paragraph?.runs[0]?.text).toBe("Water turns to ________ when heated.");
    expect(paragraph?.runs[0]?.text).not.toContain("vapour");
  });

  it("still leaves a rule when the gap has no recorded answer", () => {
    const element: GapTextElement = {
      id: "g",
      type: "gap-text",
      x: 0,
      y: 0,
      w: 400,
      h: 100,
      doc: doc([para([text("A [[gap:missing]] here.")])]),
      style: { preset: "body" },
    };
    expect(gapTextToBlanks(element, undefined)[0]?.runs[0]?.text).toBe("A _____ here.");
  });
});

describe("formatClock", () => {
  it("is mm:ss, clamped at zero", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(65)).toBe("01:05");
    expect(formatClock(600)).toBe("10:00");
    expect(formatClock(-5)).toBe("00:00");
  });
});

describe("exportLessonPptx", () => {
  it("names the file after the lesson", () => {
    expect(pptxFilename({ title: "Fractions of amounts" } as Lesson)).toBe(
      "fractions-of-amounts.pptx",
    );
  });

  it("writes a real pptx for a demo lesson", async () => {
    const [water] = demoLibrary();
    if (!water) throw new Error("fixture");
    const blob = await exportLessonPptx(water, getTheme(water.themeId));
    expect(blob.type).toContain("presentationml");
    expect(blob.size).toBeGreaterThan(10_000);
    // A pptx is a zip: the first two bytes are "PK".
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    expect(String.fromCharCode(...head)).toBe("PK");
  }, 30_000);

  it("exports an image-match slide without throwing", async () => {
    const [water] = demoLibrary();
    if (!water) throw new Error("fixture");
    const lesson: Lesson = {
      ...water,
      slides: [...water.slides, newSlide("image-match", water.themeId)],
    };
    const blob = await exportLessonPptx(lesson, getTheme(water.themeId));
    expect(blob.type).toContain("presentationml");
    expect(blob.size).toBeGreaterThan(10_000);
  }, 30_000);

  it("adds the answers slide only when asked (answers default off, ADR 0023 §7)", async () => {
    const [water] = demoLibrary();
    if (!water) throw new Error("fixture");
    if (!water) throw new Error("fixture");
    const withAnswers = await exportLessonPptx(water, getTheme(water.themeId), {
      includeAnswers: true,
    });
    const without = await exportLessonPptx(water, getTheme(water.themeId));
    expect(without.size).toBeLessThan(withAnswers.size);
  }, 30_000);

  // A GIF from the Add image panel is an image element like any other: embedded
  // when the bytes are reachable, a labelled plate when they are not. Neither
  // path may throw and lose the whole deck.
  it("exports a GIF, embedded or as a labelled plate", async () => {
    const lesson = {
      id: "l1",
      title: "GIFs",
      slides: [
        slide([
          {
            id: "i1",
            type: "image",
            x: 40,
            y: 40,
            w: 200,
            h: 200,
            fit: "contain",
            src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
            credit: "Rain Cloud via Tenor",
          },
          {
            id: "i2",
            type: "image",
            x: 300,
            y: 40,
            w: 200,
            h: 200,
            fit: "contain",
            // Refused at once, which is the CORS-blocked case without a network call.
            src: "https://127.0.0.1:1/missing.gif",
            alt: "A GIF that could not be fetched",
          },
        ]),
      ],
    } as Lesson;

    const blob = await exportLessonPptx(lesson, theme, { includeAnswers: false });
    expect(blob.size).toBeGreaterThan(1_000);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(Object.keys(zip.files).some((name) => name.endsWith(".gif"))).toBe(true);
    const xml = await zip.file("ppt/slides/slide1.xml")?.async("string");
    expect(xml).toContain("A GIF that could not be fetched");
  }, 30_000);
});

/* ------------------------------------------------------------------ */
/* The file itself                                                     */
/* ------------------------------------------------------------------ */

/**
 * These read the emitted OOXML rather than the intermediate objects. A mapping
 * test can pass while the file is wrong — `softBreakBefore` was set and never
 * written, and a group drew every child on every build slide — so the parts of
 * the contract a teacher actually opens are asserted against `ppt/slides/*.xml`.
 */
describe("the emitted slide XML", () => {
  const slidesXml = async (blob: Blob): Promise<string[]> => {
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => Number(/(\d+)/.exec(a)?.[1]) - Number(/(\d+)/.exec(b)?.[1]));
    return Promise.all(names.map((name) => zip.file(name)?.async("string") ?? ""));
  };

  const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

  const deck = (elements: SlideElement[], extra: Partial<Slide> = {}): Lesson =>
    ({ id: "l1", title: "Export test", slides: [slide(elements, extra)] }) as Lesson;

  const write = async (lesson: Lesson) =>
    slidesXml(await exportLessonPptx(lesson, theme, { includeAnswers: false }));

  it("reveals a grouped child on its own build slide, not with the group", async () => {
    const group: SlideElement = {
      id: "g",
      type: "group",
      x: 40,
      y: 40,
      w: 400,
      h: 240,
      children: [
        textElement({ id: "a", x: 0, y: 0, doc: doc([para([text("Photosynthesis")])]) }),
        textElement({
          id: "b",
          x: 0,
          y: 120,
          revealStep: 1,
          doc: doc([para([text("Chlorophyll")])]),
        }),
      ],
    };
    const xml = await write(deck([group]));
    expect(xml).toHaveLength(2);
    expect(xml[0]).toContain("Photosynthesis");
    expect(xml[0]).not.toContain("Chlorophyll");
    expect(xml[1]).toContain("Photosynthesis");
    expect(xml[1]).toContain("Chlorophyll");
    expect(xml[0]).not.toBe(xml[1]);
  }, 30_000);

  it("offsets a grouped child by the group, in EMU", async () => {
    const group: SlideElement = {
      id: "g",
      type: "group",
      x: 72,
      y: 36,
      w: 400,
      h: 240,
      children: [textElement({ id: "a", x: 0, y: 0, w: 200, h: 50 })],
    };
    const xml = (await write(deck([group])))[0] ?? "";
    // 72pt + 0 = 1in = 914400 EMU across, 36pt = half an inch down.
    expect(xml).toContain('<a:off x="914400" y="457200"/>');
  }, 30_000);

  it("writes a shift+enter as a soft break inside one paragraph", async () => {
    const element = textElement({
      doc: doc([para([text("Evaporation"), { type: "hardBreak" }, text("Condensation")])]),
    });
    const xml = (await write(deck([element])))[0] ?? "";
    expect(xml).toContain("<a:br/>");
    expect(occurrences(xml, "<a:p>")).toBe(1);
    expect(xml).toContain("Evaporation");
    expect(xml).toContain("Condensation");
  }, 30_000);

  it("still writes a real paragraph break for a new paragraph", async () => {
    const element = textElement({ doc: doc([para([text("First")]), para([text("Second")])]) });
    const xml = (await write(deck([element])))[0] ?? "";
    expect(occurrences(xml, "<a:p>")).toBe(2);
    expect(xml).not.toContain("<a:br/>");
  }, 30_000);

  it("drops an option chip that only repeats the card, as the renderer does", async () => {
    const option: OptionElement = {
      id: "o1",
      type: "option",
      x: 80,
      y: 300,
      w: 360,
      h: 80,
      label: "True",
      doc: doc([para([text("True")])]),
    };
    const xml =
      (await write(deck([option], { question: { type: "true-false", correct: true } })))[0] ?? "";
    expect(occurrences(xml, "<a:t>True</a:t>")).toBe(1);
  }, 30_000);

  it("keeps a chip that carries its own information", async () => {
    const option: OptionElement = {
      id: "o1",
      type: "option",
      x: 80,
      y: 300,
      w: 360,
      h: 80,
      label: "A",
      doc: doc([para([text("Evaporation")])]),
    };
    const xml =
      (
        await write(
          deck([option], {
            question: { type: "multiple-choice", options: [{ id: "o1", correct: true }] },
          }),
        )
      )[0] ?? "";
    expect(xml).toContain("<a:t>A</a:t>");
    expect(xml).toContain("<a:t>Evaporation</a:t>");
  }, 30_000);
});

describe("place", () => {
  const frame = { dx: 100, dy: 50, rotation: 0, cx: 300, cy: 200, opacity: 1 };

  it("leaves an ungrouped element exactly as it is", () => {
    const element = textElement();
    expect(place(element, { dx: 0, dy: 0, rotation: 0, cx: 0, cy: 0, opacity: 1 })).toBe(element);
  });

  it("offsets a child into the slide", () => {
    const placed = place(textElement({ x: 10, y: 20 }), frame);
    expect([placed.x, placed.y]).toEqual([110, 70]);
  });

  it("multiplies the group opacity into the child", () => {
    const placed = place(textElement({ opacity: 0.5 }), { ...frame, opacity: 0.5 });
    expect(placed.opacity).toBeCloseTo(0.25, 6);
  });

  it("spins a child about the group centre and about itself", () => {
    // A 90° group turn sends a child centred at (400,200) — 100pt right of the
    // group centre — to 100pt below it, and the child turns 90° too.
    const placed = place(textElement({ x: 350, y: 150, w: 100, h: 100, rotation: 10 }), {
      dx: 0,
      dy: 0,
      rotation: 90,
      cx: 300,
      cy: 200,
      opacity: 1,
    });
    expect(placed.x + 50).toBeCloseTo(300, 6);
    expect(placed.y + 50).toBeCloseTo(300, 6);
    expect(placed.rotation).toBe(100);
  });
});

describe("image credentials (TEACH-272 §1)", () => {
  it("sends the cookie to the api origin only", () => {
    const origin = "https://api.example.test";
    expect(imageCredentials(`${origin}/files/ws/img/a.png`, origin)).toBe("include");
    expect(imageCredentials("https://elsewhere.example/pic.png", origin)).toBe("omit");
    expect(imageCredentials(`${origin}/files/x`, undefined)).toBe("omit");
  });
});

describe("the revealed card (TD item 4 leftover; row 4)", () => {
  const slidesXml = async (blob: Blob): Promise<string[]> => {
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => Number(/(\d+)/.exec(a)?.[1]) - Number(/(\d+)/.exec(b)?.[1]));
    return Promise.all(names.map((name) => zip.file(name)?.async("string") ?? ""));
  };
  const option = (id: string, label: string, word: string): OptionElement => ({
    id,
    type: "option",
    x: 80,
    y: 300,
    w: 360,
    h: 80,
    label,
    doc: doc([para([text(word)])]),
  });
  const deck = (): Lesson =>
    ({
      id: "l1",
      title: "Badge",
      slides: [
        slide([option("o1", "A", "Evaporation"), option("o2", "B", "Freezing")], {
          question: {
            type: "multiple-choice",
            options: [
              { id: "o1", correct: true },
              { id: "o2", correct: false },
            ],
          },
        }),
      ],
    }) as Lesson;
  const correct = theme.colors.correct.replace("#", "").toUpperCase();

  it("draws the tick badge and the correct ring on the right card only, with answers on", async () => {
    const xml = await slidesXml(await exportLessonPptx(deck(), theme, { includeAnswers: true }));
    // Slide 1 is the question; slide 2 is the Answers slide.
    expect(xml).toHaveLength(2);
    const [question, answers] = xml;
    expect(question).toContain("<a:t>✓</a:t>");
    expect((question ?? "").split("<a:t>✓</a:t>").length - 1).toBe(1);
    expect(question).toContain(`<a:srgbClr val="${correct}"`);
    expect(answers).toContain("Answers");
    expect(answers).toContain("Evaporation");
  }, 30_000);

  it("leaves both cards at rest, and writes no Answers slide, by default", async () => {
    const xml = await slidesXml(await exportLessonPptx(deck(), theme));
    expect(xml).toHaveLength(1);
    expect(xml[0]).not.toContain("<a:t>✓</a:t>");
    expect(xml[0]).not.toContain(`<a:srgbClr val="${correct}"`);
  }, 30_000);
});
