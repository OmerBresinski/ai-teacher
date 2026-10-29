import { describe, expect, test } from "bun:test";
import { getTheme, THEMES } from "@tj/slides/themes";
import { checkSlide } from "./checks";
import FIXTURE from "./fixtures/greatfire-y2-slides.json" with { type: "json" };
import { LAYOUT_FAULT, layoutGate } from "./layout-gate";
import { materialise } from "./materialise";

/*
 * TEACH-247 part af: the Great Fire of London lesson (Year 2, genlab run 20261026-023923) shipped
 * slide 12 with "clipped: surface:field-b runs off the slide" (the answer column, a full-bleed
 * ground) and slide 9 with overlaps, because production's checks only log. Every slide the writer
 * wrote is laid out in every theme and stage, put through the layout gate, and must ship with no
 * layout fault, the myth slide (9) included (part ae fixed its own faults).
 */
type S = Record<string, unknown>;
const SLIDES = FIXTURE.slides as S[];
const STAGES = ["ks1", "ks2"] as const;

const lay = (k: number, theme: string, stage: string) =>
  materialise(
    SLIDES[k] as S,
    {
      brief: { keyStage: stage, year: stage === "ks1" ? 2 : 4, theme } as never,
      theme: getTheme(theme, stage),
      stage,
      index: k + 2,
      plan: { flow: [], slides: SLIDES },
      visual: () => ({ status: "pending" }),
    } as never,
  );

const faultsOf = (k: number, m: ReturnType<typeof lay>) =>
  checkSlide({
    index: k + 2,
    slide: m.slide,
    over: m.over,
    questions: [],
    answers: undefined,
    notesChecked: false,
    words: "",
  }).faults.filter((f) => LAYOUT_FAULT.test(f));

describe("the Great Fire lesson ships with no layout fault after the gate (TEACH-247 part af)", () => {
  for (const t of THEMES)
    for (const stage of STAGES)
      test(`${t.id} ${stage}`, () => {
        const left: { slide: number; faults: string[] }[] = [];
        SLIDES.forEach((_s, k) => {
          const gate = layoutGate({
            faults: () => faultsOf(k, lay(k, t.id, stage)),
            // No continuation here (the stage's split is covered by layout-gate-replay.test.ts).
            split: () => false,
            undoSplit: () => {},
          });
          if (gate.outcome === "left") left.push({ slide: k + 3, faults: gate.faults });
        });
        expect(left).toEqual([]);
      });
});
