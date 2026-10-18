import { describe, expect, test } from "bun:test";
import { LAYOUT_WRITER_MENUS, MENU_AGE, MENU_CHARS_PER_WORD } from "./layout-menu";
import { PILOT_PACK_ID, pilotRequest } from "./pilot-pack";
import type { WriterStage } from "./schema";
import {
  CHARS_PER_WORD,
  MIN_SHOWN_WORDS,
  offerable,
  SHOWN_SHARE,
  shownChars,
  shownWords,
  wordsWithin,
} from "./shown-cap";
import { slotFillArrival } from "./slot-fill";

/*
 * Loop 1 of the layout pilot (17 Oct 2026, build/CRAMMING-ROOT-CAUSE.md): the writer is shown about
 * 75% of each measured cap, no body field under 5 words, and no count whose cap halves.
 */
const STAGES: readonly WriterStage[] = ["KS1", "KS2", "KS3-5"];

describe("shown caps", () => {
  test("one characters-per-word constant, the menu's age table read from it", () => {
    expect(CHARS_PER_WORD).toEqual({ KS1: 5.8, KS2: 6.6, "KS3-5": 7.0 });
    for (const s of STAGES) expect(MENU_CHARS_PER_WORD[MENU_AGE[s]]).toBe(CHARS_PER_WORD[s]);
  });

  test("the shown numbers are pinned: about 75% of the cap, in characters and words", () => {
    expect(SHOWN_SHARE).toBe(0.75);
    expect(shownChars(100)).toBe(75);
    expect(shownChars(49)).toBe(36);
    // The KS2 hinge option (hinge-capacity.json primary: 49 characters) was shown 9 words.
    expect(shownWords(49, "KS2")).toBe(5);
    expect(wordsWithin(49, "KS2")).toBe(7);
    expect(shownWords(231, "KS2")).toBe(26);
    expect(shownWords(41, "KS1")).toBe(5);
    expect(shownWords(58, "KS3-5")).toBe(6);
    for (const s of STAGES)
      for (let c = 0; c <= 300; c += 1) {
        expect(shownWords(c, s) * CHARS_PER_WORD[s]).toBeLessThanOrEqual(c * SHOWN_SHARE + 1e-9);
        expect(shownWords(c, s)).toBeLessThanOrEqual(wordsWithin(c, s));
      }
  });

  test("offerable stops at the floor and at a cliff, keeping the offer contiguous", () => {
    expect(
      offerable([
        [2, 25],
        [3, 13],
        [4, 10],
        [5, 5],
      ]),
    ).toEqual([
      [2, 25],
      [3, 13],
      [4, 10],
      [5, 5],
    ]);
    // v4.8's practice cliff: 4 tasks at 14 words, 5 tasks at 6.
    expect(
      offerable([
        [4, 14],
        [5, 6],
        [6, 6],
      ]),
    ).toEqual([[4, 14]]);
    expect(
      offerable([
        [2, 8],
        [3, 4],
        [4, 6],
      ]),
    ).toEqual([[2, 8]]);
  });
});

/** Every `N[ to M] <things>: up to W words` clause of a Fits text, grouped into runs by mode. */
function runsOf(fits: string): { mode: string; pairs: [number, number][] }[] {
  const out: { mode: string; pairs: [number, number][] }[] = [];
  const re =
    /(\d+)(?: to (\d+))? (items?|tasks?|questions?|options|sides? [a-z ]+?)(?:, every icon null)?: (?:heading up to \d+ words, )?up to (\d+) words/;
  let kind = "";
  // Decision 30: counts past WORD_TASK_MAX carry the calculation-only qualifier.
  const plain = fits.replaceAll(", only when every task is a one-line calculation", "");
  for (const piece of plain.split(/; |\. With /)) {
    const m = re.exec(piece);
    if (!m) continue;
    // A prefix before the count ("with a lead of up to 7 words: ", "a picture ...: the same,
    // except ") starts a mode of its own, as does a new kind of thing counted.
    const prefix = piece.slice(0, m.index).trim();
    const k = (m[3] as string).replace(/^(\w+?)s?(\b|$)/, "$1");
    if (prefix || k !== kind || !out.length) out.push({ mode: `${k} ${prefix}`.trim(), pairs: [] });
    kind = k;
    for (let n = Number(m[1]); n <= Number(m[2] ?? m[1]); n += 1)
      out.at(-1)?.pairs.push([n, Number(m[4])]);
  }
  return out;
}

describe("guard: every generated layout at every stage", () => {
  for (const [layout, menu] of Object.entries(LAYOUT_WRITER_MENUS))
    for (const stage of STAGES)
      test(`${layout} ${stage}: no body cap under ${MIN_SHOWN_WORDS} words, no cliff`, () => {
        const line = menu[stage];
        const fits = /Fits: (.*)$/.exec(line)?.[1] ?? "";
        const runs = runsOf(fits);
        expect(runs.length).toBeGreaterThan(0);
        // A quick-check question is one line by design (exempt from the floor, layout-menu.ts).
        const floor = layout === "question-set" ? 3 : MIN_SHOWN_WORDS;
        const faults: string[] = [];
        for (const { mode, pairs } of runs)
          for (const [i, [n, w]] of pairs.entries()) {
            if (w < floor) faults.push(`${mode} ${n}: ${w} words < ${floor}`);
            const prev = pairs[i - 1];
            // Decision 32: the hinge's most options are for short options only, so they may sit
            // under half of the sentence options one count down; its line must say so.
            const sentenceRule = layout === "hinge" && line.includes("full sentence");
            if (prev && prev[0] < n && w * 2 < prev[1] && !sentenceRule)
              faults.push(`${mode} ${n}: ${w} words < half of ${prev[1]}`);
          }
        for (const m of fits.matchAll(/with a lead of up to (\d+) words/g))
          if (Number(m[1]) < MIN_SHOWN_WORDS) faults.push(`lead ${m[1]} words`);
        expect(faults).toEqual([]);
      });
});

describe(`pilot pack ${PILOT_PACK_ID}: every field is logged against its cap`, () => {
  test("hinge, practice and exit-ticket fields carry capWords and shownWords", () => {
    const r = pilotRequest(PILOT_PACK_ID, "KS2", {}, (sc) => sc);
    const slides = [
      {
        template: "hinge",
        heading: "Which vessel carries blood away from the heart?",
        options: [
          { text: "An artery", icon: null, why: null },
          { text: "A vein", icon: null, why: "Thinks every vessel leads away" },
        ],
      },
      {
        template: "practice",
        heading: "Try these",
        picture: null,
        items: [
          { question: "Name the vessel that carries blood away.", answer: "Artery", working: null },
          { question: "Name the vessel that brings blood back.", answer: "Vein", working: null },
        ],
      },
      {
        template: "exit-ticket",
        heading: "Before you go",
        items: [{ question: "What does the heart pump?", answer: "Blood", working: null }],
      },
    ];
    for (const s of slides) {
      const a = slotFillArrival(s, "KS2", r.schema, r.caps);
      const paths = a.fields.map((f) => f.path);
      expect(paths.length, s.template).toBeGreaterThan(0);
      for (const f of a.fields) {
        expect(f.capWords).toBeGreaterThan(0);
        expect(f.shownWords).toBeLessThanOrEqual(f.capWords);
      }
      if (s.template === "hinge") expect(paths).toContain("options[0].text");
      else expect(paths).toContain("items[0].question");
    }
  });
});
