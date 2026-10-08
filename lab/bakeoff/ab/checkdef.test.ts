// Arm "checkdef" $0 tests: base5 + one checks definition in the writer's flow step and in
// objective-repair. Code switches, schemas and every other prompt are base5's; England and New
// Zealand both carry the definition, and locale3's line stays NZ-only.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AB_CONFIG, AB_REF, abFiles, STAGES } from "./arms";
import { compileLocale, nzUkBrief, ukObjectives } from "./localecompile";

const read = (f: string) => readFileSync(f, "utf8");
const DEF =
  "A slide checks an objective when pupils answer a question or do a task on it: a question-set, practice, hinge or exit-ticket slide. A slide that explains or models only teaches, even when it asks pupils something.";
const OLD = "A slide checks an objective when pupils answer a question or do a task on it.";
const PLACE = "Where the topic depends on place, use what is true for pupils in New Zealand.";

describe("arm checkdef", () => {
  test("code switches are base5's plus objRetry, diffed against base5", () => {
    const { delta: _a, ...c } = AB_CONFIG.checkdef;
    const { delta: _b, ...b5 } = AB_CONFIG.base5;
    expect(c).toEqual({ ...b5, objRetry: true });
    expect(AB_CONFIG.base5.objRetry).toBeUndefined();
    expect(AB_REF.checkdef).toEqual({ ref: "base5" });
  });
  test("writer systems are base5's with the one sentence swapped; schemas are base5's", () => {
    for (const st of STAGES) {
      expect(read(abFiles("checkdef", st).system)).toBe(
        read(abFiles("base5", st).system).replace(OLD, DEF),
      );
      expect(read(abFiles("checkdef", st).system).split(DEF).length).toBe(2);
      expect(read(abFiles("checkdef", st).schema)).toBe(read(abFiles("base5", st).schema));
      expect(read(abFiles("checkdef", st).repairSchema)).toBe(
        read(abFiles("base5", st).repairSchema),
      );
    }
  });
  for (const c of ["uk", "nz"] as const)
    test(`${c}: writer and objective-repair carry the definition; the rest equals base5`, () => {
      const x = compileLocale("checkdef", nzUkBrief(c), ukObjectives());
      const b = compileLocale("base5", nzUkBrief(c), ukObjectives());
      expect(x.writer).toContain(DEF);
      expect(x["objective-repair"]).toContain(DEF);
      expect(x.writer).toBe(b.writer.replace(OLD, DEF));
      expect(x.objectives).toBe(b.objectives);
      expect(x.director).toBe(b.director);
      expect(x["objective-repair"].replace(` ${DEF}`, "")).toBe(b["objective-repair"]);
      if (c === "nz") expect(x.writer).toContain(PLACE);
      else expect(x.writer).not.toContain(PLACE);
    });
});
