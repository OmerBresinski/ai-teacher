import { describe, expect, test } from "bun:test";
import c1 from "./bundles/pilot-v4.5/base-KS1.schema.json" with { type: "json" };
import c2 from "./bundles/pilot-v4.5/base-KS2.schema.json" with { type: "json" };
import c3 from "./bundles/pilot-v4.5/base-KS3.schema.json" with { type: "json" };
import NEED from "./content-need.json" with { type: "json" };
import { FIT_LAYOUTS, fitOffer } from "./fit-fits";
import { HINGE_WRITER_MENU, PRACTICE_WRITER_MENU, shownCells, WORD_TASK_MAX } from "./layout-menu";
import { PILOT_PACKS } from "./pilot-pack";
import type { WriterStage } from "./schema";
import { isCensored, needOf, shownFor, shownWords, wordsWithin } from "./shown-cap";
import { defCaps, fitNeedKey } from "./slot-fill";

/*
 * Need-aware shown caps (CAP-NEED-AUDIT.md, 18 Oct 2026): every shown body cap is at most what the
 * slide holds (its room), at least the content's need p80 where the room allows it, and at most
 * twice that need (unless the need is censored, a lower bound). Fields with no need row keep the
 * 75% share.
 */
type J = Record<string, any>;
const STAGES: WriterStage[] = ["KS1", "KS2", "KS3-5"];
const CAPS: Record<WriterStage, J> = { KS1: c1, KS2: c2, "KS3-5": c3 };

/** The two directions, and the 2x ceiling, for one shown cap. */
function check(what: string, stage: WriterStage, shown: number, room: number, key?: string) {
  expect(shown, `${stage} ${what}: over its room`).toBeLessThanOrEqual(room);
  const need = needOf(key, stage);
  if (need === undefined) return;
  expect(shown, `${stage} ${what}: under its need`).toBeGreaterThanOrEqual(Math.min(need, room));
  // A censored need is a lower bound, so twice it is no ceiling (decision 32).
  if (!isCensored(key, stage))
    expect(shown, `${stage} ${what}: over twice its need`).toBeLessThanOrEqual(2 * need);
}

describe("the content-need table", () => {
  test("every row names its source, count and p80, per known stage", () => {
    for (const [key, row] of Object.entries(NEED as J)) {
      if (key === "$comment") continue;
      expect(key).toMatch(/^[a-z-]+\.[a-z]+$/);
      for (const [stage, cell] of Object.entries(row as J)) {
        expect(STAGES as string[]).toContain(stage);
        expect(cell.p80).toBeGreaterThan(0);
        expect(cell.n).toBeGreaterThanOrEqual(5);
        expect(String(cell.src).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("shown caps hold the room and the need", () => {
  for (const stage of STAGES) {
    test(`${stage}: menu layouts (lists, sides, hinge, quick check, practice, exit)`, () => {
      const cells = shownCells(stage);
      expect(cells.length).toBeGreaterThan(10);
      for (const c of cells) check(c.cell, stage, c.shown, c.room, c.need);
    });

    test(`${stage}: fit layouts, every offered fit's body fields`, () => {
      const offer = fitOffer(stage);
      for (const layout of FIT_LAYOUTS)
        for (const fit of offer[layout] ?? []) {
          const def = (CAPS[stage].$defs as J)[`${layout}~${fit}`];
          for (const [path, chars] of defCaps(def)) {
            const key = fitNeedKey(layout, path, fit);
            if (!key || chars <= 0) continue;
            const shown = shownFor(chars, stage, key);
            check(`${layout} ${fit} ${path}`, stage, shown, wordsWithin(chars, stage), key);
          }
        }
    });
  }

  test("the rule itself, over every cap size and need row", () => {
    for (const stage of STAGES)
      for (const key of Object.keys(NEED as J).filter((k) => k !== "$comment"))
        for (let chars = 1; chars <= 400; chars += 1)
          check(
            `${key} at ${chars}`,
            stage,
            shownFor(chars, stage, key),
            wordsWithin(chars, stage),
            key,
          );
  });

  test("a censored need (a lower bound) shows the room (decision 32)", () => {
    for (let chars = 1; chars <= 200; chars += 1)
      expect(shownFor(chars, "KS3-5", "split-compare.side")).toBe(wordsWithin(chars, "KS3-5"));
  });

  test("need unknown keeps the 75% share; a smaller room is never exceeded", () => {
    expect(shownFor(100, "KS2", "title.lead")).toBe(shownWords(100, "KS2"));
    expect(shownFor(100, "KS2")).toBe(shownWords(100, "KS2"));
    expect(shownFor(100, "KS2", "split-compare.side", 50)).toBeLessThanOrEqual(
      wordsWithin(50, "KS2"),
    );
  });

  test("the audited cases move as proposed", () => {
    // KS2 hinge at 2-3 options shows its own room, not the 4-option 5 words.
    const hinge = shownCells("KS2").filter((c) => c.cell.startsWith("hinge"));
    expect(hinge.find((c) => c.cell === "hinge 4 option")?.shown).toBeGreaterThanOrEqual(7);
    expect(hinge.find((c) => c.cell === "hinge 2 option")?.shown).toBeGreaterThan(7);
    // GOLD-THROUGH-PROD.md: KS3 4-option hinge shows the probe's 11 words (the gold's 10-11-word
    // options render on one line).
    expect(shownCells("KS3-5").find((c) => c.cell === "hinge 4 option")?.shown).toBe(11);
    // Master (#582) keeps the KS2 quick check to one line (cap 42): its room, under the need.
    const q4 = shownCells("KS2").find((c) => c.cell === "question-set 4 question");
    expect(q4?.shown).toBe(q4?.room);
    // KS3 exit ticket offers 3 questions (no cliff); KS1 practice offers 3 pictured tasks.
    expect(shownCells("KS3-5").some((c) => c.cell === "exit 3")).toBe(true);
    expect(shownCells("KS1").some((c) => c.cell === "practice+picture 3")).toBe(true);
  });
});

describe("decisions 30 and 32 (18 Oct 2026) in the menu lines", () => {
  for (const stage of STAGES) {
    test(`${stage}: word tasks stop at WORD_TASK_MAX; more are calculation-only`, () => {
      const line = PRACTICE_WRITER_MENU[stage];
      const fits = line.slice(line.indexOf("Fits:"));
      const counts = [...fits.matchAll(/(\d+)(?: to (\d+))? tasks(,[^:]*)?:/g)];
      expect(counts.length).toBeGreaterThan(0);
      for (const m of counts) {
        const top = Number(m[2] ?? m[1]);
        if (top > WORD_TASK_MAX)
          expect(m[3]).toContain("only when every task is a one-line calculation");
        else expect(m[3]).toBeUndefined();
      }
    });
    test(`${stage}: the most hinge options stay for short options; long ones take one fewer`, () => {
      const offer = shownCells(stage).filter((c) => c.cell.startsWith("hinge"));
      const most = Math.max(...offer.map((c) => Number(c.cell.split(" ")[1])));
      const line = HINGE_WRITER_MENU[stage];
      const at = (n: number) => offer.find((c) => c.cell === `hinge ${n} option`)?.shown ?? 0;
      if (most >= 4 && at(most - 1) > at(most))
        expect(line).toContain(
          `as a belief written as a full sentence does, take ${most - 1} options.`,
        );
      else expect(line).not.toContain("full sentence");
    });
  }
  test("KS2 and KS3 offer 4 short options and 3 sentence options of 15 words or more", () => {
    for (const stage of ["KS2", "KS3-5"] as const) {
      const offer = shownCells(stage);
      expect(offer.some((c) => c.cell === "hinge 4 option")).toBe(true);
      expect(offer.find((c) => c.cell === "hinge 3 option")?.shown).toBeGreaterThanOrEqual(15);
    }
  });
});

describe("one source for word budgets (18 Oct 2026)", () => {
  test("no pack carries the pilot's stale layouts.json budgets; the menu feeds both", () => {
    for (const id of ["v4.7", "v4.8"] as const)
      expect(Object.keys(PILOT_PACKS[id].layouts)).not.toContain("budgets");
  });
});
