// Arm "locale" $0 tests: England compiles byte for byte to base4; another country reaches every prompt
// and leaves no England behind; the computed tokens.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { type Brief, fillTemplate } from "../harness";
import { ENGLAND, INDIA, type Locale, localise } from "../locale";
import { AB, abFiles, STAGES } from "./arms";
import { locale2Briefs } from "./locale2compile";
import { compileLocale, nzUkBrief, ukObjectives } from "./localecompile";

const NZ: Locale = { ...INDIA, country: "New Zealand", curriculum: "The New Zealand Curriculum" };
const read = (f: string) => readFileSync(f, "utf8");

describe("locale tokens", () => {
  test("setting is empty for England (and no locale), one sentence elsewhere", () => {
    expect(localise("in {{locale.country}}.{{locale.setting}} X", ENGLAND)).toBe("in England. X");
    expect(localise("in {{locale.country}}.{{locale.setting}} X", NZ)).toBe(
      "in New Zealand. Follow the curriculum, conventions and setting of New Zealand. X",
    );
  });
  test("keyStageNote keeps England's key stage and drops it for other countries", () => {
    const b = nzUkBrief("uk");
    expect(fillTemplate("Year group: {{yearGroup}}{{keyStageNote}}", b)).toBe(
      "Year group: Year 1 (ks1)",
    );
    expect(fillTemplate("{{keyStageNote}}x", { ...b, locale: undefined } as Brief)).toBe(" (ks1)x");
    expect(fillTemplate("Year group: {{yearGroup}}{{keyStageNote}}", nzUkBrief("nz"))).toBe(
      "Year group: Year 1",
    );
  });
});

describe("arm locale", () => {
  test("England compiles to base4's text for every prompt (locale given or absent)", () => {
    const uk = nzUkBrief("uk");
    for (const b of [uk, { ...uk, locale: undefined } as Brief]) {
      const a = compileLocale("locale", b, ukObjectives());
      const base = compileLocale("base4", b, ukObjectives());
      expect(a).toEqual(base);
    }
  });
  test("England writer systems equal base4's files for every stage", () => {
    for (const st of STAGES)
      expect(localise(read(abFiles("locale", st).system), ENGLAND)).toBe(
        read(abFiles("base4", st).system),
      );
  });
  test("schemas are base4's", () => {
    for (const st of STAGES)
      expect(read(abFiles("locale", st).schema)).toBe(read(abFiles("base4", st).schema));
  });
  test("New Zealand reaches the writer, objectives, objective repair and director; no England", () => {
    const nz = compileLocale("locale", nzUkBrief("nz"), ukObjectives());
    for (const [k, v] of Object.entries(nz)) {
      expect(v, k).toContain("New Zealand");
      expect(v, k).not.toContain("England");
      expect(v, k).not.toContain("{{");
    }
    expect(nz.writer).toContain("Follow the curriculum, conventions and setting of New Zealand.");
    expect(nz.writer).toContain("Year group: Year 1\n");
    expect(nz.director).toContain("taught in New Zealand.");
  });
  test("base4 still says England for the NZ brief (the bug this arm fixes)", () => {
    expect(compileLocale("base4", nzUkBrief("nz"), ukObjectives()).writer).toContain(
      "expert teacher in England",
    );
  });
  test("arm files exist under the A/B prompt root", () => {
    expect(read(`${AB}/prompts/locale/shared/objectives.txt`)).toContain("{{locale.setting}}");
  });
});

describe("arm locale2", () => {
  const PLACE = "Where the topic depends on place, use what is true for pupils in";
  test("place is empty for England (and no locale), one sentence elsewhere", () => {
    expect(localise("x.{{locale.place}} y", ENGLAND)).toBe("x. y");
    expect(localise("x.{{locale.place}} y", NZ)).toBe(
      `x. ${PLACE} New Zealand: which months each season falls in, the hemisphere, the climate, local plants and animals, festivals, currency and units. y`,
    );
  });
  test("England compiles to base4's text for every prompt (locale given or absent)", () => {
    const uk = nzUkBrief("uk");
    for (const b of [uk, { ...uk, locale: undefined } as Brief])
      expect(compileLocale("locale2", b, ukObjectives())).toEqual(
        compileLocale("base4", b, ukObjectives()),
      );
  });
  test("England writer systems equal base4's files; schemas are base4's", () => {
    for (const st of STAGES) {
      expect(localise(read(abFiles("locale2", st).system), ENGLAND)).toBe(
        read(abFiles("base4", st).system),
      );
      expect(read(abFiles("locale2", st).schema)).toBe(read(abFiles("base4", st).schema));
    }
  });
  test("NZ, US and India: the place line in writer, objectives and repair; no England", () => {
    for (const [c, b] of Object.entries(locale2Briefs())) {
      if (c === "uk") continue;
      const r = compileLocale("locale2", b, ukObjectives());
      for (const k of ["writer", "objectives", "objective-repair"] as const) {
        expect(r[k], `${c} ${k}`).toContain(`${PLACE} ${b.locale?.country}:`);
        expect(r[k], `${c} ${k}`).not.toContain("England");
        expect(r[k], `${c} ${k}`).not.toContain("{{");
      }
    }
  });
  test("locale differs from locale2 only by the place sentence", () => {
    const b = nzUkBrief("nz");
    const a = compileLocale("locale2", b, ukObjectives());
    const l = compileLocale("locale", b, ukObjectives());
    const strip = (s: string) => s.replace(/ Where the topic depends on place[^.]*\./g, "");
    for (const k of Object.keys(a) as (keyof typeof a)[]) expect(strip(a[k]), k).toBe(l[k]);
    expect(l.writer).not.toContain(PLACE);
  });
});

describe("arm locale3", () => {
  const SHORT = "Where the topic depends on place, use what is true for pupils in";
  test("placeShort is empty for England, one short sentence (no list) elsewhere", () => {
    expect(localise("x.{{locale.placeShort}} y", ENGLAND)).toBe("x. y");
    expect(localise("x.{{locale.placeShort}} y", NZ)).toBe(`x. ${SHORT} New Zealand. y`);
  });
  test("England compiles to base4's text for every prompt (locale given or absent)", () => {
    const uk = nzUkBrief("uk");
    for (const b of [uk, { ...uk, locale: undefined } as Brief])
      expect(compileLocale("locale3", b, ukObjectives())).toEqual(
        compileLocale("base4", b, ukObjectives()),
      );
  });
  test("England writer systems equal base4's files; schemas are base4's", () => {
    for (const st of STAGES) {
      expect(localise(read(abFiles("locale3", st).system), ENGLAND)).toBe(
        read(abFiles("base4", st).system),
      );
      expect(read(abFiles("locale3", st).schema)).toBe(read(abFiles("base4", st).schema));
    }
  });
  test("NZ, US and India: the short line in writer, objectives and repair; no list, no England", () => {
    for (const [c, b] of Object.entries(locale2Briefs())) {
      if (c === "uk") continue;
      const r = compileLocale("locale3", b, ukObjectives());
      for (const k of ["writer", "objectives", "objective-repair"] as const) {
        expect(r[k], `${c} ${k}`).toContain(`${SHORT} ${b.locale?.country}.`);
        expect(r[k], `${c} ${k}`).not.toContain("which months each season");
        expect(r[k], `${c} ${k}`).not.toContain("England");
        expect(r[k], `${c} ${k}`).not.toContain("{{");
      }
    }
  });
  test("locale3 and locale2 differ only in the place sentence", () => {
    const b = nzUkBrief("nz");
    const a = compileLocale("locale3", b, ukObjectives());
    const l = compileLocale("locale2", b, ukObjectives());
    const strip = (s: string) => s.replace(/ Where the topic depends on place[^.]*\./g, "");
    for (const k of Object.keys(a) as (keyof typeof a)[]) expect(strip(a[k]), k).toBe(strip(l[k]));
  });
});
