// Arm "locale4" $0 tests (D33 open items): base5 + the stock caption fix (ab/caption.ts). Prompts are
// base5's byte for byte in every country; the objectives step already carries the country line.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  AB_CONFIG,
  AB_REF,
  abFiles,
  abShared,
  pictureVersions,
  SHARED_PINNED,
  STAGES,
} from "./arms";
import { localAlt, localiseSlideAlts } from "./caption";
import { locale2Briefs } from "./locale2compile";
import { compileLocale, nzUkBrief, ukObjectives } from "./localecompile";

const read = (f: string) => readFileSync(f, "utf8");
const PLACE = "Where the topic depends on place, use what is true for pupils in";

describe("arm locale4", () => {
  test("code switches are base5's plus captions; ref base5; base5's picture prompts", () => {
    const { delta: _a, captions, ...l4 } = AB_CONFIG.locale4;
    const { delta: _b, ...b5 } = AB_CONFIG.base5;
    expect(captions).toBe(true);
    expect(l4).toEqual(b5);
    expect(AB_REF.locale4).toEqual({ ref: "base5" });
    expect(pictureVersions("locale4")).toEqual(pictureVersions("base5"));
  });
  test("prompt files equal base5's byte for byte", () => {
    for (const st of STAGES)
      for (const k of ["system", "schema", "repairSchema"] as const)
        expect(read(abFiles("locale4", st)[k])).toBe(read(abFiles("base5", st)[k]));
    const root = (a: string) => abFiles(a as never, "KS1").system.replace(/\/T\/.*$/, "");
    for (const f of SHARED_PINNED) {
      let a: string | undefined;
      let b: string | undefined;
      try {
        a = read(`${root("locale4")}/${f}`);
      } catch {}
      try {
        b = read(`${root("base5")}/${f}`);
      } catch {}
      expect(a).toBe(b);
    }
    expect(abShared()).toBeUndefined();
  });
  test("England compiles byte-exact to base5 for every prompt", () => {
    const uk = nzUkBrief("uk");
    expect(compileLocale("locale4", uk, ukObjectives())).toEqual(
      compileLocale("base5", uk, ukObjectives()),
    );
  });
  test("NZ, US and India: objectives and writer carry the country and the line", () => {
    for (const [c, b] of Object.entries(locale2Briefs())) {
      if (c === "uk") continue;
      const got = compileLocale("locale4", b, ukObjectives());
      expect(got).toEqual(compileLocale("base5", b, ukObjectives()));
      const country = (b as { locale: { country: string } }).locale.country;
      for (const k of ["writer", "objectives", "objective-repair"] as const) {
        expect(got[k]).toContain(`${PLACE} ${country}.`);
        expect(got[k]).not.toContain("England");
        expect(got[k]).not.toContain("{{");
      }
      expect(got.objectives).toContain(`expert teacher in ${country}`);
    }
  });
});

describe("localAlt", () => {
  const nz = (alt: string, context = "") => localAlt(alt, { country: "New Zealand", context });
  test("drops a foreign closing place, keeps the subject", () => {
    expect(
      nz("A lone oak tree stands tall in a winter landscape in Greater London, England."),
    ).toBe("A lone oak tree stands tall in a winter landscape.");
    expect(nz("Children playing on a beach in Sydney, Australia")).toBe(
      "Children playing on a beach",
    );
  });
  test("keeps the teacher's country, a place the slide names, and time words", () => {
    expect(nz("Pōhutukawa in bloom at Takapuna, Auckland, New Zealand.")).toBe(
      "Pōhutukawa in bloom at Takapuna, Auckland, New Zealand.",
    );
    expect(nz("Big Ben at dusk in London, England.", "Visiting London")).toBe(
      "Big Ben at dusk in London, England.",
    );
    expect(nz("A snowy field in Winter.")).toBe("A snowy field in Winter.");
    expect(
      localAlt("Bluebells in Greater London, England.", { country: "England", context: "" }),
    ).toBe("Bluebells in Greater London, England.");
  });
  test("leaves captions with no closing place alone", () => {
    for (const s of [
      "Red and yellow leaves on the ground",
      "A child in a raincoat in the rain.",
      "",
    ])
      expect(nz(s)).toBe(s);
  });
  test("slides: image alts change, source evidence does not", () => {
    const alt = "A bare oak in winter in Greater London, England.";
    const slide = {
      elements: [
        { type: "text", doc: { content: [{ type: "text", text: "Winter trees" }] } },
        { type: "image", alt, source: { evidence: { alt } } },
      ],
    };
    const out = localiseSlideAlts(slide, "New Zealand");
    expect(out.elements[1]).toEqual({
      type: "image",
      alt: "A bare oak in winter.",
      source: { evidence: { alt } },
    });
  });
});
