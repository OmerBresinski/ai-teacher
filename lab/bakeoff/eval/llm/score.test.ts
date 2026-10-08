import { describe, expect, test } from "bun:test";
import {
  lookSlides,
  norm,
  objectivesSlideText,
  pictureText,
  type Slide,
  slideText,
  summariseObjectives,
  verifyCite,
} from "./score";

const teach = (n: number, texts: string[], pictures: Slide["pictures"] = []): Slide => ({
  n,
  role: "teach",
  texts: texts.map((text) => ({ text })),
  questions: [],
  pictures,
});
const ask = (n: number, qs: string[]): Slide => ({
  n,
  role: "question",
  texts: qs.map((text) => ({ text })),
  questions: qs.map((text) => ({ text, options: [] })),
  pictures: [],
});

// base5-1 y12 s4: a drawn table whose alt is one generic sentence.
const TABLE_ALT = "Sensory register, STM and LTM differ in coding, capacity and duration.";
const table = {
  kind: "diagram",
  alt: TABLE_ALT,
  labels: [
    TABLE_ALT,
    "Store",
    "Coding",
    "Capacity",
    "Duration",
    "STM",
    "Mainly acoustic",
    "7 ± 2 items",
    "18–30 seconds",
  ],
  background: false,
};

describe("fix 1: norm strips a slash", () => {
  test("a label / text quote matches a slide that joins them with a newline (base5-1 y1 s4)", () => {
    const s = teach(4, ["Cow and calf", "A calf is a young cow."]);
    expect(
      verifyCite({ 4: s }, { slide: 4, quote: "Cow and calf / A calf is a young cow." }, "teach"),
    ).toBe(true);
  });
  test("still strips the old punctuation and squeezes spaces", () => {
    expect(norm("“Half” — of 1/2!")).toBe("half of 1 2");
  });
  test("a quote that is not on the slide still fails", () => {
    expect(
      verifyCite(
        { 4: teach(4, ["Cow and calf"]) },
        { slide: 4, quote: "A lamb is a young sheep." },
        "teach",
      ),
    ).toBe(false);
  });
});

describe("fix 2: a drawn table is shown by its cells, not only its alt", () => {
  test("objectives text carries the cells once, without repeating the alt", () => {
    const t = pictureText(table);
    expect(t).toBe(
      `[diagram: ${TABLE_ALT} Labels: Store; Coding; Capacity; Duration; STM; Mainly acoustic; 7 ± 2 items; 18–30 seconds]`,
    );
    expect(
      objectivesSlideText(teach(4, ["Three stores, different properties"], [table])),
    ).toContain("Mainly acoustic");
  });
  test("a quote from a cell verifies on that slide", () => {
    const s = teach(4, ["Three stores, different properties"], [table]);
    expect(verifyCite({ 4: s }, { slide: 4, quote: "Mainly acoustic; 7 ± 2 items" }, "teach")).toBe(
      true,
    );
  });
  test("other calls keep the alt-only text, so their cached requests stay valid", () => {
    expect(slideText(teach(4, [], [table]))).toBe(`[diagram: ${TABLE_ALT}]`);
  });
  test("a picture with no labels, or no alt, renders as before", () => {
    expect(pictureText({ kind: "photo", alt: "A hen", labels: [] })).toBe("[photo: A hen]");
    expect(pictureText({ kind: "diagram", alt: "", labels: ["A", "B"] })).toBe("[diagram: A; B]");
  });
  test("labels are capped", () => {
    const many = Array.from({ length: 60 }, (_, i) => `c${i}`);
    expect(pictureText({ kind: "diagram", alt: "t", labels: many }).split("; ").length).toBe(40);
  });
});

describe("fault 3: a look-only slide is reported, never counted (v3)", () => {
  // base5-1 y2: o1's look listed practice slide 12, checked was empty.
  const deck = {
    objectives: [
      { id: "o1", text: "Recognise halves and quarters of shapes." },
      { id: "o2", text: "Find half of a number." },
      { id: "o3", text: "Calculate a mean rate." },
    ],
    slides: [
      ask(2, ["What is half of 4?"]),
      teach(3, ["One half: one of two equal parts."]),
      teach(6, ["Share 10 counters into two equal groups."]),
      ask(11, ["Find half of 18 apples."]),
      ask(12, ["Draw a rectangle. Split it into halves. Shade one half."]),
      ask(13, [
        "Calculate a mean rate",
        "A reaction makes 48 cm³ in 60 s. Calculate its mean rate in cm³/s.",
      ]),
    ],
  };
  const resp = {
    objectives: [
      {
        id: "o1",
        look: "2, 3, 12",
        taught: [{ slide: 3, quote: "One half: one of two equal parts." }],
        checked: [],
      },
      {
        id: "o2",
        look: "6, 11, 12",
        taught: [{ slide: 6, quote: "Share 10 counters into two equal groups." }],
        checked: [{ slide: 11, quote: "Find half of 18 apples." }],
      },
      // polish2-1 y11: cited, but the quote merges the heading into the question, so it fails.
      {
        id: "o3",
        look: "13",
        taught: [],
        checked: [{ slide: 13, quote: "Calculate a mean rate in cm³/s." }],
      },
    ],
  };
  const [o1, o2, o3] = summariseObjectives(deck, resp);
  test("a question slide in look with no cite does not count (v1 behaviour)", () => {
    expect(o1.checked).toEqual([]);
    expect(o1.lookOnly).toEqual([{ slide: 12, reason: "no cite" }]);
  });
  test("a cited slide whose quote fails the check does not count either", () => {
    expect(o3.checked).toEqual([]);
    expect(o3.lookOnly).toEqual([{ slide: 13, reason: "cite quote failed" }]);
  });
  test("retrieval slides before the first teaching slide, and verified checks, are not look-only", () => {
    expect(o1.lookOnly.map((x) => x.slide)).not.toContain(2);
    expect(o2.checked).toEqual([11]);
    expect(o2.lookOnly).toEqual([{ slide: 12, reason: "no cite" }]);
  });
  test("teaching slides in look never become checks", () => {
    const r = summariseObjectives(deck, {
      objectives: [{ id: "o1", look: "3", taught: [], checked: [] }],
    });
    expect(r[0].checked).toEqual([]);
    expect(r[0].lookOnly).toEqual([]);
  });
  test("look parsing takes lists, ranges and words", () => {
    expect(lookSlides("3, 4, 5, 12")).toEqual([3, 4, 5, 12]);
    expect(lookSlides("slides 3-5 and 12")).toEqual([3, 4, 5, 12]);
    expect(lookSlides("none")).toEqual([]);
  });
});
