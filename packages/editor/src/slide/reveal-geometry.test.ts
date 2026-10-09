import { describe, expect, test } from "bun:test";
import type { Slide, SlideElement, Theme } from "@tj/domain/documents";
import { SLIDE_H, SLIDE_W } from "@tj/domain/documents";
import { alignMarkers, atKeyStage, isBackdrop, isMarker, markerPairs, THEMES } from "@tj/slides";
import {
  activityFixtures,
  layoutTemplate,
  type Stage,
  type TemplateInput,
  templateSamples,
} from "@tj/slides/templates";
import { choiceMarks } from "./elements/choice";
import { explanationText, fontFloor, resolveFontSize } from "./elements/kit";
import evidence from "./fixtures/reveal-evidence.json";
import {
  type AnswerLane,
  answerHeight,
  answerLane,
  answerTextWidth,
  type Box,
  hasText,
  hiddenByAnswer,
  intersects,
  TICK_D,
  tickSpot,
} from "./reveal-geometry";

/*
 * TEACH-101 part d. Geometry, in slide space, of the reveal chrome against the words on the slide:
 * the revealed answer and the tick never meet a text box, and a numbered item's first line is level
 * with its marker. Every template sample and activity fixture, at every key stage, on every theme;
 * plus the three slides from the bake-off render that showed the bugs (y1-science-animals-young).
 */

const STAGES: Stage[] = ["ks1", "ks2", "ks3", "ks4", "ks5"];
const evidenceSlides = evidence.slides as unknown as Slide[];
const slideOf = (id: string) => evidenceSlides.find((s) => s.id === id) as Slide;
const splash = THEMES.find((t) => t.id === evidence.themeId) ?? (THEMES[0] as Theme);

function laneFor(slide: Slide, theme: Theme) {
  const text = explanationText(slide.question);
  if (!text) return null;
  const base = resolveFontSize(theme, "small");
  const floor = fontFloor("small");
  const stepped = Math.max(floor, Math.round(base * 0.86));
  return answerLane(slide, text, { base, stepped, floor }, theme);
}

function laidOut(): { label: string; slide: Slide; theme: Theme }[] {
  const inputs: { name: string; input: TemplateInput; stages: Stage[] }[] = [
    ...templateSamples().map((input) => ({ name: input.template, input, stages: STAGES })),
    ...activityFixtures(() => ({ src: "" })).map((f) => ({
      name: f.name,
      input: f.input,
      stages: STAGES,
    })),
  ];
  const out: { label: string; slide: Slide; theme: Theme }[] = [];
  for (const theme of THEMES)
    for (const { name, input, stages } of inputs)
      for (const stage of stages) {
        const r = layoutTemplate(input, theme, stage);
        out.push({
          label: `${name} ${stage} ${theme.id}`,
          slide: { id: `${name}-${stage}`, ...r.slide } as Slide,
          theme: atKeyStage(theme, stage),
        });
      }
  return out;
}
const corpus = laidOut();

const textBoxes = (slide: Slide, except?: string): SlideElement[] =>
  slide.elements.filter((e) => e.id !== except && !isBackdrop(e) && hasText(e));

/**
 * What is wrong with a lane: off the slide, clipping the answer (its estimated height taller than
 * the lane), or, for a free lane, over a box; a stage-mode reveal must still clear the heading.
 */
function laneFaults(label: string, slide: Slide, theme: Theme, lane: AnswerLane): string[] {
  const out: string[] = [];
  const text = explanationText(slide.question) ?? "";
  if (lane.x < 0 || lane.y < 0 || lane.x + lane.w > SLIDE_W || lane.y + lane.h > SLIDE_H)
    out.push(`${label}: off the slide`);
  const need = answerHeight(text, answerTextWidth(lane), lane.size, lane.lineHeight, theme);
  if (need > lane.h) out.push(`${label}: answer clipped (${need} > ${lane.h})`);
  if (lane.size < fontFloor("small")) out.push(`${label}: under the floor`);
  // Nothing still drawn underlaps the answer: a free lane meets no element, and a big answer takes
  // off the slide everything its lane meets (never the heading).
  const hidden = hiddenByAnswer(slide, lane);
  const shown = slide.elements.filter((x) => !hidden.has(x.id) && !isBackdrop(x));
  for (const e of shown) if (intersects(lane, e)) out.push(`${label}: over ${e.name ?? e.type}`);
  if (lane.mode === "lane" && [...hidden].some((id) => id !== lane.replaces))
    out.push(`${label}: a free lane hid an element`);
  if (slide.elements.some((x) => x.name === "Heading" && hidden.has(x.id)))
    out.push(`${label}: heading hidden`);
  return out;
}

const LONG_ANSWER = [
  "1. A puppy, which is a young dog.",
  "2. It gets bigger as it grows: its legs get longer, its body gets heavier and it can run much further than it could when it was born.",
  "3. It comes to look more like an adult dog, with a larger body, a longer face, thicker fur and more grown-up proportions, until it looks like its parents.",
].join("\n");

describe("the revealed answer is always shown whole", () => {
  test("evidence slides and a long answer, at KS1 to KS5: never clipped, never over a word", () => {
    const hits: string[] = [];
    const modes = new Set<string>();
    for (const stage of STAGES) {
      const theme = atKeyStage(splash, stage);
      const cases: [string, Slide][] = [
        ["s6", slideOf("s6")],
        ["s8", slideOf("s8")],
        [
          "s8 long",
          {
            ...slideOf("s8"),
            question: { type: "open-response", modelAnswer: LONG_ANSWER },
          } as Slide,
        ],
      ];
      for (const [name, slide] of cases) {
        const lane = laneFor(slide, theme);
        if (!lane) {
          hits.push(`${name} ${stage}: no lane`);
          continue;
        }
        modes.add(lane.mode);
        hits.push(...laneFaults(`${name} ${stage}`, slide, theme, lane));
      }
    }
    expect(hits).toEqual([]);
    // The long answer cannot sit beside the pictures: it takes the reveal's own state.
    expect(modes.has("stage")).toBe(true);
  });
});

describe("the revealed answer never meets a text box", () => {
  test("s6 'Name their parents': the whole answer, clear of 'Point and say.' and every item", () => {
    const slide = slideOf("s6");
    const theme = atKeyStage(splash, "ks1");
    const lane = laneFor(slide, theme);
    expect(lane).not.toBeNull();
    if (!lane) return;
    expect(laneFaults("s6", slide, theme, lane)).toEqual([]);
    // Two lines at the floor fit in the instruction's place: the big answer is not needed.
    expect(lane.mode).toBe("lane");
    expect(lane.replaces).toBe(slide.elements.find((e) => e.name === "Instruction")?.id);
  });

  test("every template with a reveal answer, at every key stage and theme", () => {
    let checked = 0;
    const hits: string[] = [];
    for (const { label, slide, theme } of corpus) {
      const lane = laneFor(slide, theme);
      if (!lane) continue;
      checked++;
      hits.push(...laneFaults(label, slide, theme, lane));
    }
    expect(checked).toBeGreaterThan(0);
    expect(hits).toEqual([]);
  });
});

describe("the tick on a right card sits in a gutter no text enters", () => {
  const ticks = (slide: Slide): Box[] =>
    choiceMarks(slide, true, 0)
      .filter((m) => m.state === "right")
      .flatMap(({ id }) => {
        const card = slide.elements.find((e) => e.id === id);
        if (!card) return [];
        const s = tickSpot(slide, card);
        return [{ x: card.x + s.left, y: card.y + s.top, w: TICK_D, h: TICK_D }];
      });

  test("s10 hinge: the tick clears 'It gets bigger and more like its parent.'", () => {
    const slide = slideOf("s10");
    const [tick] = ticks(slide);
    expect(tick).toBeDefined();
    for (const e of textBoxes(slide)) expect(intersects(tick as Box, e)).toBe(false);
  });

  test("every choice template, at every key stage and theme", () => {
    let checked = 0;
    const hits: string[] = [];
    for (const { label, slide } of corpus)
      for (const tick of ticks(slide)) {
        checked++;
        for (const e of textBoxes(slide))
          if (intersects(tick, e)) hits.push(`${label}: over ${e.name ?? e.type}`);
      }
    expect(checked).toBeGreaterThan(0);
    expect(hits).toEqual([]);
  });
});

describe("a numbered item's first line is level with its marker", () => {
  const firstLineMid = (t: SlideElement) => {
    const style = (t as { style?: { fontSize?: number; lineHeight?: number } }).style ?? {};
    return t.y + ((style.fontSize ?? 28) * (style.lineHeight ?? 1.4)) / 2;
  };
  const misaligned = (slide: Slide, pairs = markerPairs(slide.elements)) => {
    const byId = new Map(slide.elements.map((e) => [e.id, e]));
    const out: string[] = [];
    for (const [m, t] of pairs) {
      const marker = byId.get(m) as SlideElement;
      const text = byId.get(t) as SlideElement;
      if (text.name !== "Item") continue;
      const d = Math.abs(marker.y + marker.h / 2 - firstLineMid(text));
      if (d > 4) out.push(`${text.name} ${Math.round(d)}px off`);
    }
    return out;
  };

  test("s8: a re-fit that pushes item 3 down a line takes its marker with it", () => {
    const slide = slideOf("s8");
    expect(misaligned(slide)).toEqual([]);
    const item3 = slide.elements.find((e) => e.name === "Item" && e.y === 315) as SlideElement;
    // What the re-fit did on the render: the item's text moved one line (41 px), its disc did not.
    const pushed = slide.elements.map((e) => (e.id === item3.id ? { ...e, y: e.y + 41 } : e));
    const pairs = markerPairs(slide.elements);
    expect(misaligned({ ...slide, elements: pushed }, pairs).length).toBe(1);
    const fixed = alignMarkers(slide.elements, pushed);
    expect(misaligned({ ...slide, elements: fixed }, pairs)).toEqual([]);
  });

  test("every numbered template, at every key stage and theme", () => {
    let checked = 0;
    const hits: string[] = [];
    for (const { label, slide } of corpus) {
      if (!slide.elements.some(isMarker)) continue;
      checked++;
      for (const h of misaligned(slide)) hits.push(`${label}: ${h}`);
    }
    expect(checked).toBeGreaterThan(0);
    expect(hits).toEqual([]);
  });
});
