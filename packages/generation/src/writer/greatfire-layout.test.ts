import { describe, expect, test } from "bun:test";
import type { Slide, SlideElement } from "@tj/domain/documents";
import { reflowSlide } from "@tj/slides/reflow";
import { getTheme, THEMES } from "@tj/slides/themes";
import { checkSlide } from "./checks";
import FIXTURE from "./fixtures/greatfire-y2-slides.json" with { type: "json" };
import { materialise, visualsOf } from "./materialise";

/*
 * TEACH-247 part ae: the Great Fire of London lesson (Year 2, Crayon Box, genlab run
 * 20261026-023923) shipped its myth slide broken: the proof picture over the fact and the proof
 * line off the slide. The template laid it cleanly; the editor's Tidy (reflowSlide) then pushed the
 * verdict and the fact ~100px down under the vote card that click 1 paints over, and the check
 * counted the vote card's words against the verdict's as overlaps. The slide the writer wrote is
 * laid out again here in every theme and stage and must come out with no layout fault, before and
 * after a reflow that grows the vote card's words.
 */
type S = Record<string, unknown>;
const SLIDES = FIXTURE.slides as S[];
const STAGES = ["ks1", "ks2"] as const;
const LAYOUT = /^(overflow|clipped|overlap|off-slide):/;

const brief = (theme: string, stage: string) => ({
  id: "t",
  topic: "The Great Fire of London",
  subject: "history",
  yearGroup: stage === "ks1" ? "Year 2" : "Year 4",
  year: stage === "ks1" ? 2 : 4,
  keyStage: stage,
  theme,
  readingLevel: "",
  language: "en-GB",
  durationMin: 60,
  exitTicketOnSlides: true,
});

const lay = (k: number, theme: string, stage: string) =>
  materialise(
    SLIDES[k] as S,
    {
      brief: brief(theme, stage),
      theme: getTheme(theme, stage),
      stage,
      index: k + 2,
      plan: { flow: [], slides: SLIDES },
      visual: () => ({ status: "pending" }),
    } as never,
  );

const layoutFaults = (k: number, slide: Pick<Slide, "elements">, over: string[]) =>
  checkSlide({
    index: k + 2,
    slide,
    over,
    questions: [],
    answers: undefined,
    notesChecked: false,
    words: "",
  }).faults.filter((f) => LAYOUT.test(f));

const MYTH = SLIDES.findIndex((s) => s.template === "myth");

describe("the Great Fire myth slide lays out with no layout fault (TEACH-247 part ae)", () => {
  for (const t of THEMES)
    for (const stage of STAGES)
      test(`${t.id} ${stage}: no overlap, no overflow, no proof picture over the fact`, () => {
        const m = lay(MYTH, t.id, stage);
        expect(layoutFaults(MYTH, m.slide, m.over)).toEqual([]);
        expect(m.over).toEqual([]);
      });
});

describe("the myth slide survives a reflow that grows its words (TEACH-247 part ae)", () => {
  for (const t of THEMES)
    for (const stage of STAGES)
      test(`${t.id} ${stage}: the verdict and the fact stay where the template put them`, () => {
        const m = lay(MYTH, t.id, stage);
        const els = m.slide.elements as SlideElement[];
        // The vote card's words measured taller than the template's ruler did.
        const grown = (a: { doc: unknown }) => {
          const e = els.find((x) => (x as { doc?: unknown }).doc === a.doc);
          const card = ["Claim open", "True or false", "Choice label"].includes(e?.name ?? "");
          return (e?.h ?? 20) + (card ? 60 : 0);
        };
        const r = reflowSlide(
          { id: "s", ...m.slide } as Slide,
          getTheme(t.id, stage),
          grown as never,
        );
        for (const e of r.elements) {
          const was = els.find((x) => x.id === e.id) as SlideElement;
          if (((e as { revealStep?: number }).revealStep ?? 0) > 0) expect(e.y).toBe(was.y);
        }
        expect(layoutFaults(MYTH, { elements: r.elements }, [])).toEqual([]);
      });
});

describe("a proof picture the myth gives way is never asked for (TEACH-247 part ae)", () => {
  const vctx = (theme: string, stage: string) =>
    ({
      brief: brief(theme, stage),
      theme: getTheme(theme, stage),
      stage,
      plan: { flow: [], slides: SLIDES },
    }) as never;
  test("the Great Fire fact needs the room: no proof ask, no picture element", () => {
    const keys = visualsOf(SLIDES[MYTH] as S, MYTH + 2, vctx("crayon", "ks1")).map((a) => a.key);
    expect(keys).toEqual([]);
    const els = lay(MYTH, "crayon", "ks1").slide.elements;
    expect(els.some((e) => e.type === "image")).toBe(false);
  });
  test("a short fact keeps its proof picture, asked for and laid in its own slot", () => {
    const s = SLIDES[MYTH] as S;
    const short = { ...s, myth: { ...(s.myth as S), fact: "Buckets, not engines." } };
    const asks = visualsOf(short, MYTH + 2, vctx("crayon", "ks1"));
    expect(asks.map((a) => a.key)).toEqual(["proof"]);
  });
});
