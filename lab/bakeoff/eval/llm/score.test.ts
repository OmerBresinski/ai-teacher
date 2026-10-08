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

describe("fix 3: an omitted check is backed by the model's own look list", () => {
  // base5-1 y2: o1's look listed practice slide 12, checked was empty.
  const deck = {
    objectives: [
      { id: "o1", text: "Recognise halves and quarters of shapes." },
      { id: "o2", text: "Find half of a number." },
    ],
    slides: [
      ask(2, ["What is half of 4?"]),
      teach(3, ["One half: one of two equal parts."]),
      teach(6, ["Share 10 counters into two equal groups."]),
      ask(11, ["Find half of 18 apples."]),
      ask(12, ["Draw a rectangle. Split it into halves. Shade one half."]),
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
    ],
  };
  test("a question slide in look counts when no check was cited", () => {
    const [o1] = summariseObjectives(deck, resp);
    expect(o1.checked).toEqual([12]);
    expect(o1.checkedFromLook).toEqual([12]);
  });
  test("a retrieval slide before the first teaching slide never counts", () => {
    expect(summariseObjectives(deck, resp)[0].checked).not.toContain(2);
  });
  test("verified checks win; look adds nothing when one exists", () => {
    const [, o2] = summariseObjectives(deck, resp);
    expect(o2.checked).toEqual([11]);
    expect(o2.checkedFromLook).toEqual([]);
  });
  test("teaching slides in look never become checks, and taught is never backed by look", () => {
    const r = summariseObjectives(deck, {
      objectives: [{ id: "o1", look: "3", taught: [], checked: [] }],
    });
    expect(r[0].checked).toEqual([]);
    expect(r[0].taught).toEqual([]);
  });
  test("the backstop can be switched off (v1 behaviour)", () => {
    expect(summariseObjectives(deck, resp, { lookBackstop: false })[0].checked).toEqual([]);
  });
  test("look parsing takes lists, ranges and words", () => {
    expect(lookSlides("3, 4, 5, 12")).toEqual([3, 4, 5, 12]);
    expect(lookSlides("slides 3-5 and 12")).toEqual([3, 4, 5, 12]);
    expect(lookSlides("none")).toEqual([]);
  });
});
