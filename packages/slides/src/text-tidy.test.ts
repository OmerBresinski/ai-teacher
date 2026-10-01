import { describe, expect, it } from "bun:test";
import type { RichDoc, Slide, SlideElement } from "@tj/domain/documents";
import { cleanDashes, cleanDashesDeep, stripListMarker, tidySlide } from "./text-tidy";

const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (...texts: string[]): RichDoc => ({ type: "doc", content: texts.map(para) });
const list = (type: "orderedList" | "bulletList", ...items: string[]): RichDoc => ({
  type: "doc",
  content: [{ type, content: items.map((t) => ({ type: "listItem", content: [para(t)] })) }],
});
const textEl = (id: string, d: RichDoc, extra: Partial<SlideElement> = {}): SlideElement =>
  ({
    id,
    type: "text",
    x: 100,
    y: 100,
    w: 500,
    h: 30,
    doc: d,
    style: { preset: "body" },
    ...extra,
  }) as SlideElement;
const plainOf = (d: RichDoc): string[] => {
  const out: string[] = [];
  const walk = (n: { type: string; text?: string; content?: unknown[] }) => {
    if (n.type === "paragraph") {
      out.push((n.content as { text?: string }[]).map((c) => c.text ?? "").join(""));
      return;
    }
    for (const c of (n.content ?? []) as never[]) walk(c);
  };
  walk(d as never);
  return out;
};

describe("stripListMarker", () => {
  it.each([
    ["1) Solve x + 3 = 7.", "Solve x + 3 = 7.", true],
    ["1. Solve x + 3 = 7.", "Solve x + 3 = 7.", true],
    ["1: Solve x + 3 = 7.", "Solve x + 3 = 7.", true],
    ["(2) Explain why.", "Explain why.", true],
    ["12) Explain why.", "Explain why.", true],
    ["a) Explain why.", "Explain why.", true],
    ["(b) Explain why.", "Explain why.", true],
    ["• Roots hold the plant.", "Roots hold the plant.", false],
    ["- Roots hold the plant.", "Roots hold the plant.", false],
    ["* Roots hold the plant.", "Roots hold the plant.", false],
    ["– Roots hold the plant.", "Roots hold the plant.", false],
    ["• 1) Solve it.", "Solve it.", true],
    ["* 1) Solve it.", "Solve it.", true],
    ["•1) Solve it.", "Solve it.", true],
    ["- 2. Solve it.", "Solve it.", true],
  ])("strips %j", (input, text, numbered) => {
    expect(stripListMarker(input)).toEqual({ text, numbered });
  });

  it.each([
    "1.5 kg of flour is needed.",
    "10:30 is when the train leaves.",
    "-5 °C is colder than 0 °C.",
    "Roots: hold the plant.",
    "A rock has crystals.",
    "3x + 2 = 11",
    "Step 1: subtract 2.",
  ])("leaves %j alone", (input) => {
    expect(stripListMarker(input)).toEqual({ text: input, numbered: false });
  });
});

describe("cleanDashes", () => {
  it.each([
    // A lone spaced em dash: a comma by default.
    ["Prices rose — each mark bought less.", "Prices rose, each mark bought less."],
    // A lone dash before a list: a colon.
    ["Three states — solid, liquid and gas.", "Three states: solid, liquid and gas."],
    // After words that announce what follows: a colon.
    ["Remember the rule — divide by the bottom.", "Remember the rule: divide by the bottom."],
    // A pair (an aside): both commas.
    ["The river — fast and full — floods the town.", "The river, fast and full, floods the town."],
    // Already a colon before it: a comma.
    ["Opening: propose cups — state the purpose", "Opening: propose cups, state the purpose"],
    // A spaced en dash between words is a dash.
    ["Prices rose – each mark bought less.", "Prices rose, each mark bought less."],
    // Unspaced em dash between words: a comma.
    ["Prices rose—each mark bought less.", "Prices rose, each mark bought less."],
    // Unspaced em dash in a number range: a spaced hyphen.
    ["Between 1990—1995 it grew.", "Between 1990 - 1995 it grew."],
    ["pages 4—6", "pages 4 - 6"],
    // A worked step's old separator.
    ["60 − 0 = 60 cm³ — find the gas volume change", "60 − 0 = 60 cm³, find the gas volume change"],
    // Next to punctuation: just dropped.
    ["It was cold, — very cold.", "It was cold, very cold."],
    // Opening or closing dash: dropped.
    ["— answer the question", "answer the question"],
    ["Answer this —", "Answer this"],
  ])("%j", (input, out) => {
    expect(cleanDashes(input)).toBe(out);
  });

  it.each([
    "From 1990–1995 the town grew.",
    "Tangent rise = 60 – 10 = 50 cm³",
    "The Nazi–Soviet Pact",
    "a well-known bath-house",
    "No dashes here.",
  ])("keeps %j", (input) => {
    expect(cleanDashes(input)).toBe(input);
  });

  it("cleans every generated string in a worksheet, not its ids or sources", () => {
    const out = cleanDashesDeep({
      id: "a—b",
      src: "data:image/svg+xml,—",
      blocks: [{ text: "Rivers — wide and slow — meander." }],
    });
    expect(out).toEqual({
      id: "a—b",
      src: "data:image/svg+xml,—",
      blocks: [{ text: "Rivers, wide and slow, meander." }],
    });
  });
});

describe("tidySlide", () => {
  const practise = (numbered: boolean): Slide =>
    ({
      id: "s",
      kind: "content",
      notes: "1: x = 4 — subtract 3.",
      elements: [
        textEl("tag", doc("PRACTICE"), { name: "Kind tag" }),
        ...[1, 2, 3].flatMap((n): SlideElement[] => [
          {
            id: `b${n}`,
            type: "shape",
            shape: "ellipse",
            x: 105,
            y: 100 * n + 10,
            w: 8,
            h: 8,
            fill: "#A94A18",
            name: "Bullet",
          } as SlideElement,
          textEl(`p${n}`, doc(numbered ? `${n}: Item ${n} — why` : `Item ${n}`), {
            name: "Point",
            x: 126,
            y: 100 * n,
            style: { preset: "body", fontSize: 20, lineHeight: 1.4 },
          } as Partial<SlideElement>),
        ]),
      ],
    }) as Slide;

  it("draws a numbered point's number where its dot was, and strips the writer's", () => {
    const out = tidySlide(practise(true));
    const numbers = out.elements.filter((e) => e.name === "Number");
    expect(numbers.map((e) => plainOf((e as { doc: RichDoc }).doc)[0])).toEqual(["1)", "2)", "3)"]);
    expect(out.elements.some((e) => e.name === "Bullet")).toBe(false);
    const points = out.elements.filter((e) => e.name === "Point");
    expect(points.map((e) => plainOf((e as { doc: RichDoc }).doc)[0])).toEqual([
      "Item 1, why",
      "Item 2, why",
      "Item 3, why",
    ]);
    expect(out.notes).toBe("1: x = 4, subtract 3.");
    const first = numbers[0] as SlideElement & { style: { color?: string; fontSize?: number } };
    expect(first.style.color).toBe("#A94A18");
    expect(first.x).toBe(126 - 26);
  });

  it("numbers a practise slide even when its items were bare (the tag says order)", () => {
    const out = tidySlide(practise(false));
    expect(out.elements.filter((e) => e.name === "Number")).toHaveLength(3);
  });

  it("keeps dots for an unordered list the layout chose, stripping any marker", () => {
    const out = tidySlide(practise(true), { ordered: false });
    expect(out.elements.filter((e) => e.name === "Bullet")).toHaveLength(3);
    expect(plainOf((out.elements.find((e) => e.id === "p1") as { doc: RichDoc }).doc)[0]).toBe(
      "Item 1, why",
    );
  });

  it("continues numbering from `start` on a continued page", () => {
    const out = tidySlide(practise(true), { ordered: true, start: 4 });
    const numbers = out.elements.filter((e) => e.name === "Number");
    expect(plainOf((numbers[0] as { doc: RichDoc }).doc)[0]).toBe("4)");
  });

  it("gives a slide one list kind and strips items' own markers", () => {
    const slide = {
      id: "m",
      kind: "content",
      elements: [
        textEl("a", list("orderedList", "1) Heat the water", "2) Add the salt")),
        textEl("b", list("bulletList", "• Salt dissolves", "- Water evaporates")),
      ],
    } as Slide;
    const out = tidySlide(slide);
    for (const e of out.elements) {
      const d = (e as { doc: RichDoc }).doc;
      expect(d.content?.[0]?.type).toBe("orderedList");
    }
    expect(plainOf((out.elements[0] as { doc: RichDoc }).doc)).toEqual([
      "Heat the water",
      "Add the salt",
    ]);
    expect(plainOf((out.elements[1] as { doc: RichDoc }).doc)).toEqual([
      "Salt dissolves",
      "Water evaporates",
    ]);
  });

  it("keeps a bullet list a bullet list, without the writer's numbers' attrs", () => {
    const slide = {
      id: "b",
      kind: "content",
      elements: [textEl("a", list("bulletList", "• Roots: hold the plant", "Leaves: make food"))],
    } as Slide;
    const out = tidySlide(slide);
    const d = (out.elements[0] as { doc: RichDoc }).doc;
    expect(d.content?.[0]?.type).toBe("bulletList");
    expect(plainOf(d)).toEqual(["Roots: hold the plant", "Leaves: make food"]);
  });

  it("strips a marker split across text runs (a bold number)", () => {
    const slide = {
      id: "r",
      kind: "content",
      elements: [
        textEl("a", {
          type: "doc",
          content: [
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        { type: "text", text: "1)", marks: [{ type: "bold" }] },
                        { type: "text", text: " Heat it" },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ],
    } as Slide;
    const out = tidySlide(slide);
    expect(plainOf((out.elements[0] as { doc: RichDoc }).doc)).toEqual(["Heat it"]);
  });

  it("is idempotent", () => {
    const once = tidySlide(practise(true));
    expect(tidySlide(once)).toEqual(once);
  });
});
