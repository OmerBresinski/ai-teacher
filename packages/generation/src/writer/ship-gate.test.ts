import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Slide } from "@tj/domain/documents";
import { measureHeadless } from "@tj/slides";
import { atKeyStage, getTheme } from "@tj/slides/themes";
import { stageOf } from "../stages/write";
import { addedWords, shipCounts, shipFaults, shipGate, shownText } from "./final-gate";
import { materialise } from "./materialise";

/*
 * RC1 (e2e-11nov ROOT-CAUSES): the ship gate on the real round-3 slides. Each fault the reviewers
 * saw on a saved deck is found, acted on in code, and nothing ships at fault; every word the gate
 * shows was on the slide before. Fixture: fixtures/round3-ship-gate.json (the saved lesson.json
 * slides, `deckSlide` = their number in the deck).
 */
type Lesson = {
  themeId: string;
  ageBand: string;
  yearGroup: string;
  slides: (Slide & { deckSlide: number })[];
};
const FIX = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures/round3-ship-gate.json"), "utf8"),
) as Record<string, Lesson>;

const ctxOf = (l: Lesson) => {
  const stage = stageOf(l.ageBand, l.yearGroup);
  const theme = atKeyStage(getTheme(l.themeId, null), stage);
  return { theme, themeId: l.themeId, stage, measure: measureHeadless(theme) };
};
const slidesOf = (l: Lesson): Slide[] => l.slides.map(({ deckSlide: _n, ...s }) => s as Slide);

describe("round 3 Y5 slide 6: the empty figure plate", () => {
  const l = FIX["y5-fractions"] as Lesson;
  const c = ctxOf(l);
  const [s6] = slidesOf(l) as [Slide];

  test("is found as an empty slot", () => {
    expect(shipFaults(s6, c.measure).some((f) => f.startsWith("empty-slot:"))).toBe(true);
  });

  test("ships as words only, nothing at fault, no word added", () => {
    const g = shipGate([s6], c);
    expect(g.records).toHaveLength(1);
    expect(g.records[0]?.action).not.toBe("none");
    expect(shipCounts(g.records).shipped).toBe(0);
    for (const s of g.slides) expect(shipFaults(s, c.measure)).toEqual([]);
    expect(addedWords([s6], g.slides)).toEqual([]);
    // The plate is gone and the slide's own words are all still there.
    expect(g.slides.some((s) => s.elements.some((e) => e.name === "Figure plate"))).toBe(false);
    const said = shownText({ elements: g.slides.flatMap((s) => s.elements) }).join(" ");
    for (const t of shownText(s6)) expect(said).toContain(t);
  });
});

describe("round 3 Y2 slide 15: the cut-off practice answer", () => {
  const l = FIX["y2-greatfire"] as Lesson;
  const c = ctxOf(l);
  const deck = slidesOf(l);
  const s15 = deck.find((s) => s.answersRole === "answers") as Slide;

  test("is found: the third answer runs past the slide's foot", () => {
    expect(shipFaults(s15, c.measure).some((f) => f.startsWith("clipped:"))).toBe(true);
  });

  test("the Answers are paginated again and none is cut off", () => {
    const g = shipGate(deck, c);
    const r = g.records.find((x) => x.id === s15.id);
    expect(r?.action).toBe("answers-paginated");
    expect(shipCounts(g.records).shipped).toBe(0);
    for (const s of g.slides) expect(shipFaults(s, c.measure)).toEqual([]);
    // Every question and answer is still shown, and only the page numbers are new.
    const before = deck.filter((s) => s.answersRole);
    const after = g.slides.filter((s) => s.answersRole);
    const said = shownText({ elements: after.flatMap((s) => s.elements) }).join(" ");
    for (const t of before.flatMap(shownText).filter((t) => !/^Answers/.test(t)))
      expect(said).toContain(t);
    expect(addedWords(before, after).filter((w) => !/^\d+$/.test(w))).toEqual([]);
    // The writer's slides are untouched (same objects).
    for (const s of deck.filter((x) => !x.answersRole)) expect(g.slides).toContain(s);
  });
});

describe("round 3 Y2 slide 10: the lost picture", () => {
  // The slide as the writer wrote it (genlab run 20261112-100228-record-e2e-y2-greatfire, debug
  // seq 111 `before`), laid with its picture never found: the slot stays open on the saved slide.
  const PEPYS = {
    icon: null,
    lead: "Samuel Pepys saw the fire.",
    cards: [
      {
        num: null,
        kind: "word",
        term: "Eyewitness account",
        unit: null,
        label: "His diary",
        meaning: "A record by someone who saw events.",
        examples: null,
      },
    ],
    figure: {
      shows: "Samuel Pepys writing in his diary in the seventeenth century.",
      subject: "named",
      must_see: ["Samuel Pepys", "Open diary", "Writing quill"],
    },
    points: [],
    heading: "Samuel Pepys’s diary",
    template: "visual-text",
  };
  const l = FIX["y2-greatfire"] as Lesson;
  const c = ctxOf(l);
  const laid = materialise(PEPYS, {
    brief: { keyStage: "ks1", year: 2, theme: "crayon" } as never,
    theme: c.theme,
    stage: "ks1",
    index: 9,
    plan: { flow: [], slides: [PEPYS] },
    goldLooks: true,
    visual: () => ({ status: "pending" }),
  } as never).slide;
  const s10 = { id: "s10", ...laid, notes: "" } as Slide;

  test("the open slot is found", () => {
    expect(shipFaults(s10, c.measure).some((f) => f.startsWith("empty-slot:"))).toBe(true);
  });

  test("ships with no empty slot, the writer's words only", () => {
    const g = shipGate([s10], c);
    expect(g.records[0]?.action).not.toBe("none");
    expect(shipCounts(g.records)).toMatchObject({ shipped: 0 });
    for (const s of g.slides) expect(shipFaults(s, c.measure)).toEqual([]);
    expect(addedWords([s10], g.slides)).toEqual([]);
    // Nothing the picture's must_see named becomes slide words (R3 "He wrote in an open diary").
    const said = shownText({ elements: g.slides.flatMap((s) => s.elements) }).join(" ");
    expect(said).not.toMatch(/quill|open diary/i);
    expect(said).toContain("Samuel Pepys saw the fire.");
  });
});

describe("the gate leaves clean slides alone and counts what it ships", () => {
  test("a clean deck: no record, same objects", () => {
    const l = FIX["y2-greatfire"] as Lesson;
    const c = ctxOf(l);
    const clean = slidesOf(l).filter((s) => !s.answersRole);
    const g = shipGate(clean, c);
    expect(g.records).toEqual([]);
    for (const [i, s] of g.slides.entries()) expect(s).toBe(clean[i] as Slide);
  });

  test("a fault nothing can clear is shipped and counted, never hidden", () => {
    const l = FIX["y2-greatfire"] as Lesson;
    const c = ctxOf(l);
    // The exit ticket (pupils answer on it: never re-laid) pushed off the slide's foot.
    const exit = slidesOf(l).find((s) => s.kind === "exit-ticket") as Slide;
    const pushed = {
      ...exit,
      elements: exit.elements.map((e) => (e.type === "text" ? { ...e, y: e.y + 400 } : e)),
    } as Slide;
    const g = shipGate([pushed], c);
    expect(g.records[0]?.action).toBe("none");
    expect(shipCounts(g.records).shipped).toBeGreaterThan(0);
    expect(g.slides[0]).toBe(pushed);
  });

  test("a fault the stage reported counts as detected", () => {
    const l = FIX["y2-greatfire"] as Lesson;
    const c = ctxOf(l);
    const exit = slidesOf(l).find((s) => s.kind === "exit-ticket") as Slide;
    const g = shipGate([exit], { ...c, reported: new Map([[exit.id, ["off-slide: a card"]]]) });
    expect(shipCounts(g.records)).toEqual({ detected: 1, acted: 0, shipped: 1 });
  });
});
