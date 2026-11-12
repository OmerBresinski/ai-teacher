import { describe, expect, test } from "bun:test";
import { flatElements, renderedLines, slideImages } from "./notes";

/*
 * BUILDER v5.3-gold B2 (12 Nov Y8 notes request 0023): the gold panel-list and split-compare nest
 * their text in a group, and the notes call saw "Slide 6: " with no words, then wrote "inspect the
 * images". Every nested name, line and side text reaches the notes, in drawing order.
 */
const t = (name: string, text: string) => ({
  type: "text",
  name,
  doc: { content: [{ content: [{ text }] }] },
});
const shape = (name: string) => ({ type: "shape", name });

const panelList = [
  {
    type: "group",
    name: "Layout",
    children: [
      shape("Background"),
      t("Heading", "How a leaf is built for photosynthesis"),
      { type: "image", name: "Panel picture", src: "https://x/leaf.jpg", alt: "A green leaf" },
      shape("Row circle"),
      t("Row name", "Broad"),
      t("Row line", "A large surface catches more light."),
      shape("Divider"),
      t("Row name", "Thin"),
      t("Row line", "Gases reach every cell quickly."),
    ],
  },
];
const splitCompare = [
  t("Heading", "Photosynthesis and respiration"),
  {
    type: "group",
    name: "Side 1",
    children: [t("Side title", "Photosynthesis"), t("Side text", "Takes in carbon dioxide.")],
  },
  {
    type: "group",
    name: "Side 2",
    children: [
      { type: "group", name: "Inner", children: [t("Side title", "Respiration")] },
      t("Side text", "Gives out carbon dioxide."),
    ],
  },
];

describe("renderedLines reads nested text (B2)", () => {
  test("a gold panel-list: heading, every row name and line", () => {
    const out = renderedLines(6, panelList as never, []);
    expect(out).toBe(
      [
        "Slide 6: How a leaf is built for photosynthesis",
        "Broad",
        "A large surface catches more light.",
        "Thin",
        "Gases reach every cell quickly.",
      ].join("\n"),
    );
  });
  test("a split-compare: each side's title and text, groups inside groups too", () => {
    const out = renderedLines(9, splitCompare as never, []);
    expect(out).toContain("Slide 9: Photosynthesis and respiration");
    for (const s of [
      "Photosynthesis",
      "Takes in carbon dioxide.",
      "Respiration",
      "Gives out carbon dioxide.",
    ])
      expect(out).toContain(s);
  });
  test("flat slides read as before", () => {
    const flat = [t("Heading", "Title"), t("Point", "One"), t("Badge", "B"), t("Option", "Two")];
    expect(renderedLines(3, flat as never, ["Picture: a leaf"])).toBe(
      "Slide 3: Title\nOne\nB. Two\nPicture: a leaf",
    );
    expect(flatElements(flat as never)).toHaveLength(4);
  });
});

describe("slideImages: the pictures a slide holds (B2)", () => {
  test("nested pictures count, diagrams and empty sources do not", () => {
    const els = [
      ...panelList,
      { type: "image", name: "Diagram", src: "data:image/svg+xml,x" },
      { type: "image", name: "Photo", src: "" },
    ];
    expect(slideImages(els as never).map((e) => e.alt)).toEqual(["A green leaf"]);
  });
});
