import { describe, expect, test } from "bun:test";
import { slotOf } from "@tj/slides/diagrams";
import { getTheme } from "@tj/slides/themes";
import { layoutSlotProbe } from "../writer/diagrams";
import { writerSchema } from "../writer/schema";
import { continueTable, drawable } from "../writer/table-pack";
import { fixture, type J } from "./harness";

/* Group B (writer-form caps) and ruling 197 (long tables pack and continue). */

const theme = getTheme("studio", "ks3" as never);
const fitsIn = (template: string) => (t: J, first: boolean) =>
  !layoutSlotProbe(drawable(t), first ? slotOf(template) : "full", "ks3", theme).length;
const FR =
  "un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize dix-sept dix-huit dix-neuf vingt".split(
    " ",
  );

/** Every cap on an array field (`rows`, `shapes`) of a kind's defs in the shipped writer schema. */
const caps = (kind: string, field: string) => {
  const out: unknown[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const o = n as J;
    const props = o.properties as J | undefined;
    const k = (props?.kind as J | undefined)?.enum as string[] | undefined;
    if (k?.[0] === kind && props?.[field]) out.push((props[field] as J).maxItems);
    for (const v of Object.values(o)) walk(v);
  };
  walk(writerSchema("KS3-5", { min: 8, max: 14 }));
  return [...new Set(out)];
};

describe("REGISTER content-01 / content-02 / diagrams-10: the writer grammar no longer closes a table at a row cap", () => {
  test("FIXED caps: table rows carry no maxItems in the writer schema (were 5 full, 6 side)", () => {
    expect(caps("table", "rows")).toEqual([undefined]);
  });
  test("FIXED content-02: decoding is never forced to close the rows mid-list, so no stray last cell", () => {
    // The stray words ('quinze blanche', 'seize soirées', 'seize toute') sat in the last cell the
    // cap allowed. With no cap the grammar never ends the array early; the recorded outputs were
    // decoded under the old cap, so a paid writer run is what shows the cells themselves.
    const rows = ((fixture("content-01-r1").slide as J).figure as { rows: string[][] }).rows;
    expect(rows.at(-1)?.[3]).toBe("quinze blanche");
    expect(caps("table", "rows")).not.toContain(rows.length);
  });
  test("FIXED diagrams-10: fraction shapes rise from 4 to what the slot now holds (6)", () => {
    expect(caps("fraction-shapes", "shapes")).toEqual([6]);
  });
});

describe("REGISTER content-01 / diagrams-10: a 1-20 table the alt promises is shown whole (ruling 197)", () => {
  for (const id of ["content-01-r1", "content-01-r2", "content-01-r3", "diagrams-10"]) {
    test(`FIXED ${id}: all twenty numbers are shown, packed into 4 columns and continued`, () => {
      const s = fixture(id).slide as J;
      const f = s.figure as J & { header: string[] | null };
      // The writer's whole table, as the alt promises it (one number and its word per row).
      const whole = {
        ...s,
        figure: {
          ...f,
          header: f.header?.slice(0, 2) ?? null,
          rows: FR.map((w, k) => [String(k + 1), w]),
        },
      };
      const r = continueTable(whole, fitsIn(String(s.template)));
      expect(r).toBeDefined();
      const tables = [r?.first, ...(r?.rest ?? [])].map(
        (x) => (x as J).figure as { rows: string[][]; header: string[] | null },
      );
      // every slide's table fits its slot and has at most 4 columns
      for (const t of tables)
        expect(Math.max(...t.rows.map((x) => x.length))).toBeLessThanOrEqual(4);
      const shown = tables.flatMap((t) => t.rows.flat());
      for (const w of FR) expect(shown).toContain(w);
      expect(shown).toContain("dix-sept");
      expect(String((r?.rest[0] as J | undefined)?.heading)).toMatch(/\(continued\)$/);
    });
  }
  test("a table that fits as written is left alone", () => {
    const s = fixture("content-01-r1").slide as J;
    expect(continueTable(s, fitsIn(String(s.template)))).toBeUndefined();
  });
});
