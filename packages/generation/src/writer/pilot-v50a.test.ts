import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  PILOT_PACK_ID,
  PILOT_PACK_LIVE,
  PILOT_PACKS,
  packFromEnv,
  packWriter,
  pilotRequest,
} from "./pilot-pack";
import { V50A_MENU_LINES } from "./pilot-v50a";

/*
 * Pilot pack v5.0a (3 Nov 2026, test runs only): the method's code checks. Every key stage builds,
 * the schema is v4.17's exactly, every limit code checks reaches the model unchanged, and the live
 * pack is untouched: with TJ_PILOT_PACK unset production runs v4.17, byte for byte as before.
 */
type J = Record<string, any>;
const KS = ["KS1", "KS2", "KS3"] as const;
const v417 = (ks: string) =>
  readFileSync(
    new URL(`bundles/pilot-v4.17-menu/system-${ks}.snapshot.txt`, import.meta.url),
    "utf8",
  );
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const fitsOf = (text: string) => text.match(/Fits: [^\n]*/g) ?? [];
// The prod-schema stand-ins every pilot test uses: a flow and slide range, a teaches enum.
const prod: J = {
  properties: {
    flow: { minItems: 9, maxItems: 13, items: { properties: { teaches: { type: "string" } } } },
    slides: { minItems: 6, maxItems: 10 },
  },
};

describe("the live pack is untouched", () => {
  test("TJ_PILOT_PACK unset: production runs v4.17", () => {
    expect(process.env.TJ_PILOT_PACK ?? "").toBe("");
    expect(PILOT_PACK_LIVE).toBe("v4.17");
    expect(PILOT_PACK_ID).toBe("v4.17");
  });

  test("the selector: unset or empty is live, a pack id is that pack, a typo throws", () => {
    expect(packFromEnv(undefined, "v4.17")).toBe("v4.17");
    expect(packFromEnv("", "v4.17")).toBe("v4.17");
    expect(packFromEnv("v5.0a", "v4.17")).toBe("v5.0a");
    expect(() => packFromEnv("v5.0", "v4.17")).toThrow("no pilot pack v5.0");
  });

  for (const ks of KS)
    test(`${ks}: v4.17's system text is byte-identical to its snapshot`, () => {
      expect(sha(PILOT_PACKS["v4.17"].system[ks])).toBe(sha(v417(ks)));
      expect(pilotRequest("v4.17", ks, prod, (s) => s).system).toBe(v417(ks));
    });
});

describe("v5.0a builds at every key stage", () => {
  for (const ks of KS) {
    const text = PILOT_PACKS["v5.0a"].system[ks];
    const live = v417(ks);

    test(`${ks}: assembled, no slot left, each menu line once with its new prose`, () => {
      expect(text).not.toContain("{{");
      for (const [layout, line] of Object.entries(V50A_MENU_LINES)) {
        expect(text.split(`\n- ${layout}: `).length, layout).toBe(2);
        expect(text).toContain(`\n- ${layout}: ${line} Fits: `);
      }
    });

    test(`${ks}: every Fits clause of v4.17 reaches the model unchanged`, () => {
      expect(fitsOf(text).sort()).toEqual(fitsOf(live).sort());
    });

    test(`${ks}: the diagram kinds and fill shapes are v4.17's, byte for byte`, () => {
      const tail = (s: string) => s.slice(s.indexOf("Diagram kinds:"));
      expect(tail(text)).toBe(tail(live));
    });

    test(`${ks}: the constraints code cannot repair are stated`, () => {
      for (const must of [
        "Nothing else on its slide gives the answer away.",
        "Code reveals the answer on a click, so no heading, instruction, label or picture gives it.",
        "the correct option comes first (code shuffles them)",
        "The slide draws list numbers, bullets and option letters, so each item is its text alone.",
        "A word count is a ceiling, not a target.",
        "The flow is final: add no slide it does not list.",
        "Words and labels go on the slide, not in the picture.",
        "never one year as both ends",
        "Answers on question-set, practice and exit-ticket are what a pupil should write",
      ])
        expect(text, must).toContain(must);
    });

    test(`${ks}: under 60% of v4.17's length (the code-kept floor is about 25%)`, () => {
      expect(text.length).toBeLessThan(live.length * 0.6);
    });
  }
});

describe("v5.0a's schema and writer are v4.17's", () => {
  for (const ks of KS)
    test(`${ks}: the request schema and caps are identical`, () => {
      const a = pilotRequest("v4.17", ks, prod, (s) => s);
      const b = pilotRequest("v5.0a", ks, prod, (s) => s);
      expect(JSON.stringify(b.schema)).toBe(JSON.stringify(a.schema));
      expect(JSON.stringify(b.caps ?? null)).toBe(JSON.stringify(a.caps ?? null));
      expect(b.system).toBe(PILOT_PACKS["v5.0a"].system[ks]);
    });

  test("same writer model and effort", () => {
    expect(packWriter("v5.0a")).toEqual(packWriter("v4.17"));
  });

  test("every switch but the system text matches v4.17", () => {
    const { system: _a, id: _i, ...a } = PILOT_PACKS["v4.17"] as J;
    const { system: _b, id: _j, ...b } = PILOT_PACKS["v5.0a"] as J;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
