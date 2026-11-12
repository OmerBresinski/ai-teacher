import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTheme } from "../themes";
import { TEMPLATE_DOCS } from "./capacity";
import { FIGURE_CAPTION_TWO_LINE_FITS } from "./figure-rules";
import { fitInput, measureGoldInput, sample } from "./fit-table";
import { layoutTemplate } from "./index";
import { PT_CAPS } from "./picture-text";

/*
 * Gold alignment (11 Nov 2026), guard 3: the fit numbers a writer is given are measured on the
 * gold look a new lesson draws, and sit at or under the gold's own caps. The gold table is
 * `fit-table-gold.gen.json` (`fit-table.ts --gold`). Known gap: the live pack (v5.0b) still reads
 * the old `fit-table.gen.json`, frozen so its prompt bytes do not move; a new pack takes the gold one.
 */
type V = { label: string; counts: Record<string, number>; chars: number; keyCards?: boolean };
type Table = {
  note: string;
  groups: Record<string, { layouts: Record<string, { variants: V[] }> }>;
};
const W = join(import.meta.dir, "../../../generation/src/writer");
const gold = JSON.parse(readFileSync(join(W, "fit-table-gold.gen.json"), "utf8")) as Table;
const old = JSON.parse(readFileSync(join(W, "fit-table.gen.json"), "utf8")) as Table;
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const AGE = { KS1: "early", KS2: "primary", "KS3-5": "secondary" } as const;

describe("the writer's fit numbers are measured on the gold look", () => {
  test("the measurer lays picture and text and big-visual photos on their golds", () => {
    for (const id of ["picture-text", "big-picture"]) {
      const doc = TEMPLATE_DOCS.find((d) => d.id === id) as (typeof TEMPLATE_DOCS)[number];
      for (const v of doc.variants) {
        const input = measureGoldInput(() => fitInput(doc, v, 40, 20, 0));
        const r = layoutTemplate(input, getTheme("crayon"), "ks2");
        expect(r.drawer, `${id} ${v.label}`).toBe(
          id === "picture-text" ? "gold:picture-text" : "gold:figure",
        );
      }
    }
  });

  for (const [g, F] of Object.entries(gold.groups)) {
    test(`${g}: visual-text at or under the picture-text gold's caps`, () => {
      const caps = PT_CAPS[g as keyof typeof PT_CAPS];
      for (const v of F.layouts["visual-text"]?.variants ?? []) {
        if (!v.chars) continue;
        const n = v.counts.points ?? 0;
        expect(n, v.label).toBeLessThanOrEqual(caps.points);
        const lead = words(sample(v.chars));
        expect(lead, `${v.label} lead`).toBeLessThanOrEqual(caps.lead);
        expect(lead + n * lead, `${v.label} words`).toBeLessThanOrEqual(caps.words);
      }
    });
    test(`${g}: big-visual's caption at or under the figure gold's two-line fit`, () => {
      for (const v of F.layouts["big-visual"]?.variants ?? [])
        expect(v.chars).toBeLessThanOrEqual(
          FIGURE_CAPTION_TWO_LINE_FITS[AGE[g as keyof typeof AGE]],
        );
    });
  }

  test("known gap: the live pack's table is the old one, frozen (not measured on the golds)", () => {
    expect(gold.note).toContain("--gold");
    expect(String(old.note ?? "")).not.toContain("--gold");
  });
});
