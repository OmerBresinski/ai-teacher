import { describe, expect, test } from "bun:test";
import { getTheme } from "@tj/slides/themes";
import { panelAspect, setMode, setSize } from "../stages/picture-set";
import { activityDefs, fromWriterActivity } from "./activities";
import { lookMet } from "./fixes";
import { visualsOf } from "./materialise";
import { slotFillArrival } from "./slot-fill";

/*
 * TEACH-247 part ce (replay 20261029-143317, plants s4 "Plant or Not?"): a 6-card group sort's
 * pictures were made as one 6-panel strip (2048x1152, 0.29 panels), and its 1.57 card slots
 * could only show each panel contained on a wash: thin upright slivers with a tiny subject. A set
 * is made as one strip or grid only when the slot shows its panels filled; else each picture is
 * made alone at the slot's shape.
 */
type S = Record<string, unknown>;
const INDEX = 3;
const base = {
  brief: {
    id: "t",
    topic: "Parts of a plant",
    subject: "science",
    yearGroup: "Year 1",
    year: 1,
    keyStage: "ks1",
    theme: "crayon",
    readingLevel: "",
    language: "en-GB",
    durationMin: 60,
    exitTicketOnSlides: true,
  },
  theme: getTheme("crayon"),
  stage: "ks1",
  plan: { flow: [{ slide: INDEX + 1 }], slides: [] },
} as never;

const writer: S = {
  template: "group-sort",
  heading: "Plant or Not?",
  instruction: "Sort each card into the right group.",
  groups: ["Plant", "Not a plant"],
  cards: [
    { label: "Tree", picture: "An oak tree in a field", group: 1 },
    { label: "Daisy", picture: "A white daisy flower", group: 1 },
    { label: "Grass", picture: "A patch of green grass", group: 1 },
    { label: "Cat", picture: "A tabby cat sitting down", group: 2 },
    { label: "Rock", picture: "A grey rock", group: 2 },
    { label: "Shoe", picture: "A child's red shoe", group: 2 },
  ],
};

describe("card pictures fill their cards", () => {
  const slide = fromWriterActivity(writer, "KS1", { id: "t" } as never).slide;
  const asks = visualsOf(slide, INDEX, base) as {
    key: string;
    aspect?: number;
    fills?: readonly [number, number];
  }[];

  test("every card's ask carries the shapes its slot shows filled", () => {
    expect(asks.length).toBe(6);
    for (const a of asks) {
      expect(a.fills).toBeDefined();
      const [lo, hi] = a.fills as readonly [number, number];
      expect(lo).toBeLessThanOrEqual(a.aspect as number);
      expect(hi).toBeGreaterThanOrEqual(a.aspect as number);
    }
  });

  test("a 6-card set is never one strip of thin panels: each picture is made at its card's shape", () => {
    const fills = asks[0]?.fills;
    expect(panelAspect(6, setSize(6))).toBeLessThan(0.3);
    expect(setMode(6, false, fills)).toBe("solo");
    // Without the slot's shapes (a split ask joined side by side), the strip stays.
    expect(setMode(6, false)).toBe("strip");
  });

  test("a two-panel strip still goes to a ranged slot that takes its shape", () => {
    expect(setMode(2, false, [0.85, 1.48])).toBe("strip");
    expect(setMode(2, false, [1.3, 1.85])).toBe("solo");
  });
});

describe("an activity is one def with no fit, and its cards meet a cards look", () => {
  test("a group sort arrives as written, never 'fit: missing'", () => {
    const a = slotFillArrival(writer, "KS1", { $defs: activityDefs("KS1") });
    expect(a.breaches).toEqual([]);
    expect(a.route).toBe("as-written");
  });
  test("a group sort that breaks its def is still a writer fault", () => {
    const a = slotFillArrival({ ...writer, groups: "Plant" }, "KS1", {
      $defs: activityDefs("KS1"),
    });
    expect(a.breaches.length).toBeGreaterThan(0);
    expect(a.route).toBe("writer-fault");
  });
  test("a cards look is met by an activity's cards, not by a text slide", () => {
    const slide = fromWriterActivity(writer, "KS1", { id: "t" } as never).slide;
    expect(lookMet(slide, { kind: "cards" })).toBe(true);
    expect(lookMet({ ...slide, cards: [{ text: "Tree" }] }, { kind: "cards" })).toBe(true);
    expect(lookMet({ template: "explain", heading: "x" }, { kind: "cards" })).toBe(false);
  });
});
