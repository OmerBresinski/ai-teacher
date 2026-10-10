import { describe, expect, test } from "bun:test";
import { slotOf } from "@tj/slides/diagrams";
import { getTheme } from "@tj/slides/themes";
import { layoutSlotProbe } from "../writer/diagrams";
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
