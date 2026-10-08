// Arm "base5" $0 tests (D32, D33): polish2's writer files with locale3's country line merged in.
// England compiles byte for byte to polish2; New Zealand carries locale3's line; the code switches
// are polish2's (no 768 px judge, colour gate logs only, protected labels never dropped).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ENGLAND, localise } from "../locale";
import { AB_CONFIG, AB_REF, abFiles, pictureVersions, STAGES } from "./arms";
import { compileLocale, nzUkBrief, ukObjectives } from "./localecompile";

const read = (f: string) => readFileSync(f, "utf8");
const PLACE = "Where the topic depends on place, use what is true for pupils in New Zealand.";

describe("arm base5", () => {
  test("code switches are polish2's, diffed against polish2, base4's picture prompts", () => {
    const { delta: _a, ...b5 } = AB_CONFIG.base5;
    const { delta: _b, ...p2 } = AB_CONFIG.polish2;
    expect(b5).toEqual(p2);
    expect(AB_REF.base5).toEqual({ ref: "polish2" });
    expect(pictureVersions("base5")).toEqual(pictureVersions("base4"));
  });
  test("England writer systems equal polish2's files and schemas are polish2's", () => {
    for (const st of STAGES) {
      expect(localise(read(abFiles("base5", st).system), ENGLAND)).toBe(
        read(abFiles("polish2", st).system),
      );
      expect(read(abFiles("base5", st).schema)).toBe(read(abFiles("polish2", st).schema));
      expect(read(abFiles("base5", st).repairSchema)).toBe(
        read(abFiles("polish2", st).repairSchema),
      );
    }
  });
  test("England compiles to polish2 for every prompt", () => {
    const uk = nzUkBrief("uk");
    expect(compileLocale("base5", uk, ukObjectives())).toEqual(
      compileLocale("polish2", uk, ukObjectives()),
    );
  });
  test("New Zealand: locale3's line in writer, objectives and repair; no England; no recall slide", () => {
    const nz = compileLocale("base5", nzUkBrief("nz"), ukObjectives());
    const l3 = compileLocale("locale3", nzUkBrief("nz"), ukObjectives());
    for (const k of ["writer", "objectives", "objective-repair"] as const) {
      expect(nz[k]).toContain(PLACE);
      expect(nz[k]).not.toContain("England");
      expect(nz[k]).not.toContain("{{");
    }
    expect(nz.objectives).toBe(l3.objectives);
    expect(nz["objective-repair"]).toBe(l3["objective-repair"]);
    expect(nz.writer).not.toContain("recalls the earlier learning");
    expect(nz.writer).toContain("- strips:");
  });
});
