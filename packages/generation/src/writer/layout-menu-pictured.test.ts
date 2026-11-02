import { describe, expect, test } from "bun:test";
import {
  assembleWriterSystem,
  ITEMS_ROW_WRITER_MENU,
  itemsRowWriterMenu,
  LAYOUT_WRITER_MENUS,
  layoutFieldCaps,
  layoutOffer,
  listCaps,
  MENU_AGE,
  MENU_CHARS_PER_WORD,
  menuWordCaps,
  PANEL_LIST_WRITER_MENU,
  PICTURED_MIN_ITEM,
  panelListWriterMenu,
} from "./layout-menu";
import { MIN_SHOWN_WORDS } from "./shown-cap";

/*
 * TEACH-247 part cv: at KS1 an item that carries its own picture or icon is offered under the
 * 5-word body floor, down to `PICTURED_MIN_ITEM` words, because the picture or icon shows the thing
 * and the line is a short label. Before, KS1 could offer panel-list with pictures at 2 items only
 * and items-row with icons at 2 or 3, so a Year 1 set of 4 plant parts took 4 slides
 * (first-principles/4-unused-layouts-rootcause.md, C5). The switch is per pack (`picturedFloor`):
 * every pack without it keeps its request byte for byte.
 */
const ON = { picturedFloor: true } as const;

describe("KS1 pictured floor (TEACH-247 part cv)", () => {
  test("off by default: the menu constants and offers are unchanged", () => {
    expect(layoutOffer("KS1")).toEqual({
      "items-row": { counts: [2, 3, 4], icons: [2, 3], numbered: [4], lead: [] },
      "panel-list": { counts: [2], plain: [2], pictures: [2], lead: [], picturesLead: [] },
      "split-compare": { sides: ["2", "3", "2p"] },
    });
    for (const stage of ["KS1", "KS2", "KS3-5"] as const) {
      expect(itemsRowWriterMenu(stage)).toBe(ITEMS_ROW_WRITER_MENU[stage]);
      expect(panelListWriterMenu(stage)).toBe(PANEL_LIST_WRITER_MENU[stage]);
    }
  });

  test("on: KS1 offers 4 iconed parts and 3 or 4 pictured kinds; text-only cells keep the floor", () => {
    const o = layoutOffer("KS1", ON);
    expect(o["items-row"]).toEqual({
      counts: [2, 3, 4],
      icons: [2, 3, 4],
      numbered: [4],
      lead: [],
    });
    expect(o["panel-list"]).toEqual({
      counts: [2, 3, 4],
      plain: [2],
      pictures: [2, 3, 4],
      lead: [],
      picturesLead: [],
    });
    expect(o["split-compare"]).toEqual(layoutOffer("KS1")["split-compare"]);
  });

  test("on: the KS1 rooms are the measured cells' shown words, never more", () => {
    const caps = menuWordCaps("KS1", ON);
    expect(caps["items-row"].items.icons).toEqual({ 2: 9, 3: 8, 4: 3 });
    expect(caps["items-row"].items.num).toEqual({ 4: 7 });
    expect(caps["panel-list"].items.pics).toEqual({ 2: 6, 3: 3, 4: 3 });
    expect(caps["panel-list"].items.plain).toEqual({ 2: 8 });
    const cpw = MENU_CHARS_PER_WORD[MENU_AGE.KS1];
    const faults: string[] = [];
    const check = (c: "items-row" | "panel-list", v: "" | "pics", got: Record<number, number>) => {
      for (const [n, words] of Object.entries(got)) {
        const cell = listCaps(c, "early", Number(n), false, v);
        if (!cell) faults.push(`${c} ${n}${v}: no measured cell`);
        else {
          if (Object.values(cell).some((x) => x <= 0))
            faults.push(`${c} ${n}${v}: not comfortable`);
          // Inside the cell's measured comfortable cap at KS1's long-word rate.
          if (words * cpw > (cell.text ?? 0))
            faults.push(`${c} ${n}${v}: ${words} words over ${cell.text} chars`);
        }
        if (words < PICTURED_MIN_ITEM.early) faults.push(`${c} ${n}${v}: ${words} under the floor`);
      }
    };
    check("items-row", "", caps["items-row"].items.icons);
    check("panel-list", "pics", caps["panel-list"].items.pics);
    expect(faults).toEqual([]);
  });

  test("on: the KS1 menu lines state the new cells", () => {
    const row = itemsRowWriterMenu("KS1", ON);
    expect(row).toContain(
      "Fits: 2 items: up to 9 words each; 3 items: up to 8 words each; 4 items: up to 3 words each; 4 items, every icon null: up to 7 words each.",
    );
    const panel = panelListWriterMenu("KS1", ON);
    expect(panel).toContain("- panel-list: a set of 2 to 4 kinds");
    expect(panel).toContain(
      "With a picture on every item: the same, except heading up to 3 words; 2 items: up to 6 words each; 3 items: up to 3 words each; 4 items: up to 3 words each.",
    );
    // Plain (text and icon) panel-list rows still stop at 2: the floor holds where no picture is.
    expect(panel).toContain("Fits: heading up to 2 words; 2 items: up to 8 words each.");
  });

  test("on: KS2 and KS3-5 are unchanged (their floor is the 5-word one)", () => {
    expect(PICTURED_MIN_ITEM.primary).toBe(MIN_SHOWN_WORDS);
    expect(PICTURED_MIN_ITEM.secondary).toBe(MIN_SHOWN_WORDS);
    for (const stage of ["KS2", "KS3-5"] as const) {
      expect(layoutOffer(stage, ON)).toEqual(layoutOffer(stage));
      expect(menuWordCaps(stage, ON)).toEqual(menuWordCaps(stage));
      expect(itemsRowWriterMenu(stage, ON)).toBe(ITEMS_ROW_WRITER_MENU[stage]);
      expect(panelListWriterMenu(stage, ON)).toBe(PANEL_LIST_WRITER_MENU[stage]);
    }
  });

  test("on: the schema's string caps do not move (the new cells are tighter than the loosest)", () => {
    for (const stage of ["KS1", "KS2", "KS3-5"] as const)
      expect(layoutFieldCaps(stage, ON)).toEqual(layoutFieldCaps(stage));
  });

  test("assembleWriterSystem takes the switch; without it the text is the constants'", () => {
    const template = [
      "Layouts:",
      ...Object.keys(LAYOUT_WRITER_MENUS).map((l) => `{{menu:${l}}}`),
      "{{rule:answers}}",
    ].join("\n");
    const off = assembleWriterSystem(template, "KS1");
    const on = assembleWriterSystem(template, "KS1", {}, ON);
    expect(off).toContain(ITEMS_ROW_WRITER_MENU.KS1);
    expect(off).toContain(PANEL_LIST_WRITER_MENU.KS1);
    expect(on).toContain(itemsRowWriterMenu("KS1", ON));
    expect(on).toContain(panelListWriterMenu("KS1", ON));
    expect(on).not.toBe(off);
    expect(assembleWriterSystem(template, "KS2", {}, ON)).toBe(
      assembleWriterSystem(template, "KS2"),
    );
  });
});
