import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  assembleWriterSystem,
  ITEMS_ROW_WRITER_MENU,
  LAYOUT_WRITER_MENUS,
  layoutOffer,
  listCaps,
  MENU_AGE,
  MENU_CHARS_PER_WORD,
  PANEL_LIST_WRITER_MENU,
  PIC_SIDE_HEADROOM,
  type SideZone,
  SPLIT_COMPARE_WRITER_MENU,
  sideCaps,
} from "./layout-menu";
import { type WriterStage, writerSchema } from "./schema";

/*
 * The menu lines read back against the renderer's measured tables (TEACH-110 part s). Every number
 * is parsed out of the line as the writer reads it, not taken from the generator, and checked
 * against the table cell it promises: the cell exists, every field in it is comfortable (cap > 0),
 * and the words it allows, at the stage's chars per word, stay inside the field's cap.
 */
const STAGES: readonly WriterStage[] = ["KS1", "KS2", "KS3-5"];
const TEMPLATE = { KS1: "KS1", KS2: "KS2", "KS3-5": "KS3" } as const;
const dir = new URL("./bundles/pilot-v4.7-menu/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, dir), "utf8");
const must = <T>(x: T | null | undefined, what = "value"): T => {
  if (x === null || x === undefined) throw new Error(`missing ${what}`);
  return x;
};
const range = (lo: number, hi: number) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

type Mode = { items: Map<number, number>; heading?: number; leadWords?: number };
type ListFits = { plain: Mode; lead: Mode; numbered: Mode };
const mode = (): Mode => ({ items: new Map() });

/** One list layout's Fits clauses, read the way the writer reads them. */
function parseList(clauses: string, base?: ListFits): ListFits {
  const out: ListFits = base
    ? {
        plain: { ...base.plain, items: new Map(base.plain.items) },
        lead: { ...base.lead, items: new Map(base.lead.items) },
        numbered: mode(),
      }
    : { plain: mode(), lead: mode(), numbered: mode() };
  let at = out.plain;
  const span = (m: RegExpExecArray) => range(Number(m[1]), Number(m[2] ?? m[1]));
  for (const piece of clauses.split("; ").filter(Boolean)) {
    let rest = piece;
    const led = /^with a lead of up to (\d+) words(?: \(heading up to (\d+)\))?(?:: (.*))?$/.exec(
      piece,
    );
    if (led) {
      at = out.lead;
      at.leadWords = Number(led[1]);
      if (led[2]) at.heading = Number(led[2]);
      if (!led[3]) continue;
      rest = led[3];
    }
    const heading = /^heading up to (\d+) words$/.exec(rest);
    const items = /^(\d+)(?: to (\d+))? items: up to (\d+) words each$/.exec(rest);
    const gone = /^(\d+)(?: to (\d+))? items: not offered$/.exec(rest);
    const num =
      /^(\d+) items, every icon null: (?:heading up to (\d+) words, )?up to (\d+) words each$/.exec(
        rest,
      );
    if (heading) at.heading = Number(heading[1]);
    else if (items) for (const n of span(items)) at.items.set(n, Number(items[3]));
    else if (gone) for (const n of span(gone)) at.items.delete(n);
    else if (num) {
      out.numbered.items.set(Number(num[1]), Number(num[3]));
      if (num[2]) out.numbered.heading = Number(num[2]);
    } else throw new Error(`unread Fits clause: "${rest}"`);
  }
  return out;
}

/** Each promise in a mode, checked against its measured cell. */
function checkMode(
  layout: "items-row" | "panel-list",
  stage: WriterStage,
  m: Mode,
  lead: boolean,
  variant: "" | "num" | "pics",
  faults: string[],
) {
  const age = MENU_AGE[stage];
  const cpw = MENU_CHARS_PER_WORD[age];
  for (const [n, words] of m.items) {
    const where = `${layout} ${stage} ${n} items${lead ? " with a lead" : ""}${variant ? ` (${variant})` : ""}`;
    const caps = listCaps(layout, age, n, lead, variant);
    if (!caps) {
      faults.push(`${where}: no measured cell`);
      continue;
    }
    for (const [f, cap] of Object.entries(caps))
      if (cap <= 0) faults.push(`${where}: ${f} is never comfortable`);
    if (words * cpw > must(caps.text))
      faults.push(`${where}: ${words} words > text cap ${caps.text}`);
    if (m.heading !== undefined && m.heading * cpw > must(caps.heading))
      faults.push(`${where}: heading ${m.heading} words > cap ${caps.heading}`);
    if (lead && m.leadWords !== undefined && m.leadWords * cpw > must(caps.lead))
      faults.push(`${where}: lead ${m.leadWords} words > cap ${caps.lead}`);
  }
}

const countRange = (line: string, re: RegExp) => {
  const m = must(re.exec(line), `count range in "${line.slice(0, 60)}"`);
  return range(Number(m[1]), Number(m[2] ?? m[1]));
};

describe("layout menu lines", () => {
  for (const stage of STAGES) {
    test(`${stage}: items-row promises only what its measured cells hold, and the schema agrees`, () => {
      const line = ITEMS_ROW_WRITER_MENU[stage];
      const fits = parseList(must(/ Fits: (.*)\.$/.exec(line))[1] as string);
      const faults: string[] = [];
      checkMode("items-row", stage, fits.plain, false, "", faults);
      checkMode("items-row", stage, fits.lead, true, "", faults);
      checkMode("items-row", stage, fits.numbered, false, "num", faults);
      expect(faults).toEqual([]);
      const counts = [
        ...new Set([...fits.plain.items.keys(), ...fits.numbered.items.keys()]),
      ].sort();
      expect(countRange(line, /^- items-row: (\d+)(?: to (\d+))? named parts/)).toEqual(counts);
      expect(layoutOffer(stage)["items-row"].counts).toEqual(counts);
      const schema = writerSchema(stage, { min: 5, max: 10 }) as {
        $defs: Record<string, { properties: { items: { minItems: number; maxItems: number } } }>;
      };
      const items = must(schema.$defs["items-row"]).properties.items;
      expect([items.minItems, items.maxItems]).toEqual([must(counts[0]), must(counts.at(-1))]);
    });

    test(`${stage}: panel-list promises only what its measured cells hold, with and without row pictures`, () => {
      const line = PANEL_LIST_WRITER_MENU[stage];
      const m = must(/ Fits: (.*?)\. With a picture on every item: (.*?)\. Each limit/.exec(line));
      const plain = parseList(m[1] as string);
      const same = /^the same(?:, except (.*))?$/.exec(m[2] as string);
      const pics = parseList(must(same, "pictures clause")[1] ?? "", plain);
      if (!same?.[1]) expect(pics.plain.items).toEqual(plain.plain.items);
      const faults: string[] = [];
      checkMode("panel-list", stage, plain.plain, false, "", faults);
      checkMode("panel-list", stage, plain.lead, true, "", faults);
      checkMode("panel-list", stage, pics.plain, false, "pics", faults);
      checkMode("panel-list", stage, pics.lead, true, "pics", faults);
      expect(faults).toEqual([]);
      const counts = [...new Set([...plain.plain.items.keys(), ...pics.plain.items.keys()])].sort();
      expect(countRange(line, /^- panel-list: a set of (\d+)(?: to (\d+))? kinds/)).toEqual(counts);
      expect(layoutOffer(stage)["panel-list"].counts).toEqual(counts);
    });

    test(`${stage}: split-compare promises only what its measured zones hold`, () => {
      const line = SPLIT_COMPARE_WRITER_MENU[stage];
      const age = MENU_AGE[stage];
      const cpw = MENU_CHARS_PER_WORD[age];
      const fits = must(/ Fits: (.*?)\. Each limit/.exec(line))[1] as string;
      const title = Number(must(/title names its thing in up to (\d+) words/.exec(line))[1]);
      const zoneOf: Record<string, SideZone> = {
        "words only": "",
        "with pictures": "p",
        "with quotes": "q",
      };
      const faults: string[] = [];
      const keys: string[] = [];
      for (const piece of fits.split("; ")) {
        const m =
          /^(\d) sides (words only|with pictures|with quotes): up to (\d+) words each(?:, plus a quote of up to (\d+) words)?$/.exec(
            piece,
          );
        if (!m) throw new Error(`unread Fits clause: "${piece}"`);
        const n = Number(m[1]);
        const z = must(zoneOf[m[2] as string]);
        keys.push(`${n}${z}`);
        const caps = sideCaps(age, n, z);
        if (!caps) {
          faults.push(`${n}${z}: no measured cell`);
          continue;
        }
        for (const [f, cap] of Object.entries(caps))
          if (cap <= 0) faults.push(`${n}${z}: ${f} never comfortable`);
        if (Number(m[3]) * cpw > must(caps.text))
          faults.push(`${n}${z}: ${m[3]} words > text cap ${caps.text}`);
        // Pictured sides keep headroom under the cap: past it the words win and the pictures shrink.
        if (z === "p" && Number(m[3]) * cpw > PIC_SIDE_HEADROOM * must(caps.text))
          faults.push(`${n}${z}: ${m[3]} words > ${PIC_SIDE_HEADROOM} of text cap ${caps.text}`);
        if (m[4] && Number(m[4]) * cpw > must(caps.quote))
          faults.push(`${n}${z}: quote ${m[4]} words > ${caps.quote}`);
        if (title * cpw > must(caps.title))
          faults.push(`${n}${z}: title ${title} words > ${caps.title}`);
      }
      expect(faults).toEqual([]);
      expect(layoutOffer(stage)["split-compare"].sides).toEqual(keys);
      expect(keys).toContain("2");
      expect(keys).toContain("3");
      expect(line.startsWith("- split-compare: a vs: 2 or 3 things")).toBe(true);
    });
  }
});

describe("writer system text", () => {
  for (const stage of STAGES)
    test(`${stage}: assembled from the menu constants, byte for byte the pinned snapshot`, () => {
      const ks = TEMPLATE[stage];
      const template = read(`system-${ks}.template.txt`);
      for (const layout of Object.keys(LAYOUT_WRITER_MENUS))
        expect(
          template.includes(`\n- ${layout}: `),
          `${ks} template holds a copy of ${layout}`,
        ).toBe(false);
      const text = assembleWriterSystem(template, stage);
      for (const menu of Object.values(LAYOUT_WRITER_MENUS))
        expect(text.split("\n")).toContain(menu[stage]);
      // A deliberate change regenerates the snapshot from assembleWriterSystem, never by hand.
      expect(text).toBe(read(`system-${ks}.snapshot.txt`));
    });

  test("a slot missing, repeated or unknown, or a menu line pasted in by hand, throws", () => {
    const t = read("system-KS2.template.txt");
    expect(() => assembleWriterSystem(t.replace("{{menu:panel-list}}", ""), "KS2")).toThrow();
    expect(() => assembleWriterSystem(`${t}\n{{menu:items-row}}`, "KS2")).toThrow();
    expect(() => assembleWriterSystem(`${t}\n{{menu:steps}}`, "KS2")).toThrow();
    expect(() => assembleWriterSystem(`${t}\n${PANEL_LIST_WRITER_MENU.KS2}`, "KS2")).toThrow();
  });
});
