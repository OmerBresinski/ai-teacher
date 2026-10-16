import { describe, expect, test } from "bun:test";
import type { LineElement, ShapeElement, SlideElement, TextElement } from "@tj/domain/documents";
import { lineBreaks } from "../text-lines";
import { lineWidth } from "../text-measure";
import { resolveFontSize } from "../text-style";
import { atKeyStage, getTheme, THEMES } from "../themes";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";
import { SOURCE_CAPS, SOURCE_NAMES, sourcePaths, splitSource } from "./source";
import { measureSourceCapacity } from "./source-capacity";
import { SOURCE_CASES } from "./source-fixtures";

/*
 * TEACH-75 part ab (C2): the source layout against its gold (`northstars-v12/source`).
 */
const paper = getTheme("paper");
const named = (els: SlideElement[], name: string) => els.filter((e) => e.name === name);
const lay = (input: TemplateInput, stage: Stage = "ks3", theme = paper) =>
  layoutTemplate(input, theme, stage);
const gold = (name: string) => {
  const k = SOURCE_CASES.find((c) => c.name === name);
  if (!k) throw new Error(name);
  return k;
};
const KEPT: Record<string, number> = { dickens: 2, owen: 3, mole: 2, tilbury: 2, max: 4 };

describe("source caps", () => {
  test("the table is the renderer's measure, and the gold's writer caps fit at the floor", () => {
    expect(measureSourceCapacity()).toEqual(SOURCE_CAPS);
    for (const cap of Object.values(SOURCE_CAPS)) {
      expect(cap.words).toBeLessThanOrEqual(cap.maxWords);
      expect(cap.lines).toBeLessThanOrEqual(cap.maxLines);
    }
  });
});

describe("source gold cases", () => {
  for (const k of SOURCE_CASES)
    for (const theme of THEMES)
      test(`${k.name} on ${theme.id}: nothing over, every note kept, sizes on the stage's steps`, () => {
        const r = lay(k.input, k.stage, theme);
        // The 88-word cap case runs past the KS3 floor in Crayon's wide hand: flagged, never clipped.
        const flagged = k.name === "max" && theme.id === "crayon";
        expect(r.over).toEqual(flagged ? ["source extract at the secondary floor"] : []);
        const els = r.slide.elements;
        expect(named(els, SOURCE_NAMES.label)).toHaveLength(KEPT[k.name] ?? 2);
        const t = atKeyStage(theme, k.stage);
        for (const e of els)
          if (e.type === "text") {
            const size = Number(e.style?.fontSize);
            expect({ name: e.name, size }).toEqual({
              name: e.name,
              size: resolveFontSize(t, "body", size),
            });
          }
      });

  test("each note's label sits level with the row where its anchor ends, joined by one line", () => {
    for (const name of ["dickens", "owen", "mole", "tilbury", "max"]) {
      const els = lay(gold(name).input, gold(name).stage).slide.elements;
      const labels = named(els, SOURCE_NAMES.label);
      const joins = named(els, SOURCE_NAMES.join) as LineElement[];
      const lights = named(els, SOURCE_NAMES.highlight) as ShapeElement[];
      labels.forEach((label, i) => {
        const step = i + 1;
        const own = lights.filter((h) => h.revealStep === step);
        expect(own.length).toBeGreaterThan(0);
        const last = own.reduce((a, b) => (b.y > a.y ? b : a));
        const rowMid = last.y + last.h / 2;
        const labelMid = label.y + label.h / 2;
        const lineH =
          Number(
            (
              (named(els, SOURCE_NAMES.extract)[0] ?? named(els, SOURCE_NAMES.verse)[0]) as
                | TextElement
                | undefined
            )?.style?.fontSize,
          ) * 1.6;
        expect(Math.abs(labelMid - rowMid)).toBeLessThanOrEqual(lineH / 2);
        const j = joins.find((x) => x.revealStep === step);
        if (j) {
          // From just past the row's end to just before the label, never through the words.
          expect(j.x + j.w).toBeLessThan(label.x);
          expect(Math.abs(j.y + j.from.y * j.h - rowMid)).toBeLessThanOrEqual(3);
          expect(Math.abs(j.y + j.to.y * j.h - labelMid)).toBeLessThanOrEqual(3);
        }
      });
    }
  });

  test("build: click 0 is the extract alone; each click adds one highlight, join and note", () => {
    const els = lay(gold("owen").input).slide.elements;
    for (const e of els) {
      const step = e.revealStep ?? 0;
      if ([SOURCE_NAMES.card, SOURCE_NAMES.from, SOURCE_NAMES.verse].includes(e.name as never))
        expect(step).toBe(0);
      else expect(step).toBeGreaterThanOrEqual(1);
    }
    const steps = [...new Set(els.map((e) => e.revealStep ?? 0))].sort();
    expect(steps).toEqual([0, 1, 2, 3]);
  });

  test("verse is one text box per line in the quote face; prose is one box", () => {
    const verse = named(
      lay(gold("owen").input).slide.elements,
      SOURCE_NAMES.verse,
    ) as TextElement[];
    // Eight verse lines, one box each; a line past the borrow turns into a second box hung in.
    const x0 = Math.min(...verse.map((v) => v.x));
    const starts = verse.filter((v) => v.x === x0);
    expect(starts).toHaveLength(8);
    for (const v of verse) expect(v.x === x0 || v.x > x0 + 20).toBe(true);
    for (const v of verse) expect(JSON.stringify(v.doc)).toContain('"font":"quote"');
    expect(named(lay(gold("dickens").input).slide.elements, SOURCE_NAMES.extract)).toHaveLength(1);
  });

  test("the card has no shadow and a thin rule edge", () => {
    const els = lay(gold("dickens").input).slide.elements;
    const cards = named(els, SOURCE_NAMES.card) as ShapeElement[];
    expect(cards).toHaveLength(1);
    expect(cards[0]?.strokeWidth).toBe(1);
    expect(els.filter((e) => /shadow/i.test(e.name ?? ""))).toEqual([]);
  });
});

describe("notes dropped in code (S-d4)", () => {
  const base = gold("dickens").input;
  test("an anchor that is not verbatim drops that note", () => {
    const notes = [
      ...(base.notes ?? []),
      { anchor: "as greedy as a wolf", label: "simile", text: "made up" },
    ];
    const r = lay({ ...base, notes });
    expect(named(r.slide.elements, SOURCE_NAMES.label)).toHaveLength(2);
    expect(r.over).toEqual([]);
  });
  test("a second anchor ending on the same row drops the later note", () => {
    const notes = [
      { anchor: "squeezing", label: "verb", text: "one" },
      { anchor: "wrenching", label: "verb", text: "two" },
      { anchor: "solitary as an oyster", label: "simile", text: "three" },
    ];
    const els = lay({ ...base, notes }).slide.elements;
    expect(
      named(els, SOURCE_NAMES.label).map((e) => JSON.stringify((e as TextElement).doc)),
    ).toEqual([expect.stringContaining('"verb"'), expect.stringContaining('"simile"')]);
  });
});

describe("a highlighted phrase that turns at a hyphen", () => {
  test("the ruler breaks after the hyphen, as the browser does", () => {
    const w = lineWidth("Bent, knock-", "body", paper) + 4;
    const text = "Bent, knock-kneed, coughing";
    expect(lineBreaks(text, "body", paper, w)).toContain(text.indexOf("kneed"));
  });
  test("the highlight ends at the measured break: its turn covers only the words after it", () => {
    const k = gold("peter");
    const els = lay(k.input, k.stage).slide.elements;
    const ex = named(els, SOURCE_NAMES.extract)[0] as TextElement;
    const size = Number(ex.style?.fontSize);
    const lights = (named(els, SOURCE_NAMES.highlight) as ShapeElement[]).filter(
      (h) => h.revealStep === 2,
    );
    // "a very big fir-tree" turns at "fir-": the second row's wash is "tree." alone, from the
    // row's start, never the whole "fir-tree." word carried over.
    expect(lights).toHaveLength(2);
    const turn = lights.reduce((a, b) => (b.y > a.y ? b : a));
    expect(turn.x).toBeLessThanOrEqual(ex.x);
    expect(turn.w).toBeLessThan(lineWidth("fir-tree", "body", paper) * (size / 20));
  });
});

describe("source extras", () => {
  test("an optional short title sits above the card (ruling 242)", () => {
    const els = lay({ ...gold("tilbury").input, heading: "How Elizabeth rallies her army" }).slide
      .elements;
    const head = els.find((e) => e.name === "Heading");
    const card = named(els, SOURCE_NAMES.card)[0];
    expect(head).toBeDefined();
    expect(card?.y ?? 0).toBeGreaterThan((head?.y ?? 0) + (head?.h ?? 0));
  });

  test("past the floor the extract is flagged, never clipped", () => {
    const long = { ...gold("mole").input, extract: (gold("max").input.extract ?? "").repeat(2) };
    const r = lay(long, "ks2");
    expect(r.over.join()).toContain("source extract");
  });

  test("an over-long extract splits at a sentence; each part keeps only its own notes", () => {
    const parts = splitSource(gold("max").input);
    expect(parts).not.toBeNull();
    const [a, b] = parts as [TemplateInput, TemplateInput];
    expect(`${a.extract} ${b.extract}`).toBe(gold("max").input.extract as string);
    expect(a.extract?.trimEnd()).toMatch(/[.!?]$/);
    expect((a.notes?.length ?? 0) + (b.notes?.length ?? 0)).toBe(4);
    expect(a.from).toBe(b.from);
  });

  test("a picture source shows its picture; without one the from words fill the card", () => {
    const pic = lay(gold("domesday").input).slide.elements;
    expect(pic.some((e) => e.type === "image")).toBe(true);
    expect(named(pic, SOURCE_NAMES.join)).toEqual([]);
    const fail = lay(gold("domesdayFail").input).slide.elements;
    expect(fail.some((e) => e.type === "image")).toBe(false);
    expect(JSON.stringify((named(fail, SOURCE_NAMES.from)[0] as TextElement).doc)).toContain(
      "quote",
    );
  });

  test("the editor binds from, extract and each note's label and text", () => {
    const els = lay(gold("dickens").input).slide.elements;
    expect(sourcePaths(els).filter(Boolean)).toEqual([
      "from",
      "extract",
      "notes.0.label",
      "notes.0.text",
      "notes.1.label",
      "notes.1.text",
    ]);
  });
});
