import { describe, expect, test } from "bun:test";
import { SLIDE_TIER_RANGES } from "@tj/domain/documents";
import { pilotRequest } from "./pilot-pack";
import { writerSchema } from "./schema";
import { slotFillArrival } from "./slot-fill";

/*
 * TEACH-247 part bq: a stages or reasons line is judged against its cell's character limit
 * (`hardMax`, the room the layout draws it in), not the word cap derived from it. The four slides
 * below are the saved v4.17 runs' six lines flagged one word over (53-56 characters on Year 4 and
 * Year 9, 48 on Year 2), all inside the characters their layouts fit.
 */
type S = Record<string, unknown>;
const ROMANS_R1: S = {
  template: "reasons",
  heading: "Why did Hadrian build it?",
  lead: "Emperor Hadrian ordered the wall to be built.",
  kind: "reasons",
  items: [
    {
      head: "Defend territory",
      line: "The wall helped Romans defend their land from attacks.",
      icon: null,
    },
    {
      head: "Control crossings",
      line: "Roman soldiers could check people passing through gates.",
      icon: null,
    },
  ],
  picture: {
    shows: "A surviving stretch of Hadrian’s Wall at Cawfields",
    must_see: ["stone wall remains", "open land beyond"],
    subject: "named",
  },
};
const GREATFIRE_R2: S = {
  template: "reasons",
  heading: "Why did fire spread?",
  lead: null,
  kind: "reasons",
  items: [
    { head: "Wooden houses", line: "Close wooden houses burned and lit other houses.", icon: null },
    { head: "Strong winds", line: "Strong winds blew flames towards more houses.", icon: null },
  ],
  picture: {
    shows: "Reconstruction of closely packed wooden London houses burning in strong wind",
    must_see: ["close wooden houses", "windblown flames"],
    subject: "generic",
  },
};
const ROMANS_R2: S = {
  template: "reasons",
  heading: "Why did Romans build it?",
  lead: null,
  kind: "reasons",
  items: [
    {
      head: "Defend territory",
      line: "The wall formed a barrier at Rome’s northern frontier.",
      icon: null,
    },
    {
      head: "Watch the frontier",
      line: "Roman soldiers could spot people approaching the wall.",
      icon: null,
    },
    {
      head: "Control crossings",
      line: "Gates let Roman soldiers check who crossed the frontier.",
      icon: null,
    },
  ],
  picture: {
    shows: "Surviving stone stretch of Hadrian’s Wall",
    must_see: ["stone wall remains", "land on both sides"],
    subject: "named",
  },
};
const RIVERS_R2: S = {
  template: "stages",
  heading: "From meander to oxbow lake",
  accentWord: null,
  items: [
    {
      name: "Erosion",
      line: "Outer-bank erosion makes the meander bends grow.",
      icon: null,
      picture: null,
    },
    {
      name: "Neck",
      line: "Erosion narrows the land between neighbouring bends.",
      icon: null,
      picture: null,
    },
    {
      name: "Cut-off",
      line: "During high flow, water cuts through the narrow neck.",
      icon: null,
      picture: null,
    },
    {
      name: "Oxbow",
      line: "Deposition seals the old bend, leaving an oxbow lake.",
      icon: null,
      picture: null,
    },
  ],
};

const CASES: [string, string, "KS1" | "KS2" | "KS3", S, string[]][] = [
  ["Year 4 Romans r1", "KS2", "KS2", ROMANS_R1, ["items[0].line"]],
  ["Year 2 Great Fire r2", "KS1", "KS1", GREATFIRE_R2, ["items[0].line"]],
  ["Year 4 Romans r2", "KS2", "KS2", ROMANS_R2, ["items[0].line", "items[2].line"]],
  ["Year 9 rivers r2", "KS3", "KS3", RIVERS_R2, ["items[2].line", "items[3].line"]],
];
const arrive = (slide: S, stageKey: string) => {
  const ks = stageKey === "KS3" ? "KS3-5" : stageKey;
  const r = pilotRequest(
    "v4.17",
    stageKey,
    writerSchema(ks as never, SLIDE_TIER_RANGES.standard),
    (x) => x,
  );
  return slotFillArrival(structuredClone(slide), stageKey, r.schema, r.caps, true);
};
const line = (slide: S, i: number) => ((slide.items as S[])[i] as S).line as string;
const withLine = (slide: S, i: number, text: string): S => {
  const s = structuredClone(slide);
  ((s.items as S[])[i] as S).line = text;
  return s;
};

describe("stages and reasons lines are judged in characters (TEACH-247 part bq)", () => {
  for (const [name, stageKey, , slide, flagged] of CASES)
    test(`${name}: the lines once flagged a word over are within their characters, not cut`, () => {
      const a = arrive(slide, stageKey);
      expect(a.cuts).toEqual([]);
      expect(a.route).toBe("as-written");
      for (const path of flagged) {
        const f = a.fields.find((x) => x.path === path);
        // Still a word over the derived word cap, and logged with the characters that judged it.
        expect(f?.words).toBe((f?.capWords ?? 0) + 1);
        expect(f?.chars).toBe(line(slide, Number(/\d+/.exec(path)?.[0])).length);
        expect(f?.chars).toBeLessThanOrEqual(f?.capChars ?? 0);
      }
    });

  test("a line past its cell's characters is still cut", () => {
    for (const [name, stageKey, , slide, flagged] of CASES) {
      const i = Number(/\d+/.exec(flagged[0] ?? "")?.[0]);
      const capChars =
        arrive(slide, stageKey).fields.find((x) => x.path === `items[${i}].line`)?.capChars ?? 0;
      expect(capChars, name).toBeGreaterThan(0);
      // Long words, few of them: under the word cap, over the characters.
      const long = `${"Extraordinarily ".repeat(Math.ceil((capChars + 1) / 16)).trim()}.`;
      const a = arrive(withLine(slide, i, long), stageKey);
      expect(a.cuts, name).toContain(`items[${i}].line`);
    }
  });

  test("a field with no measured characters (myth) keeps its word cap", () => {
    const myth: S = {
      template: "myth",
      heading: "Do plants respire?",
      myth: {
        opening: "vote",
        verdict: "myth",
        claim:
          "Plants only photosynthesise; they do not respire at all, ever, in any way, at any time of day.",
        fact: "Plants respire.",
        factEm: "respire",
        proof: null,
      },
    };
    const a = arrive(myth, "KS3");
    const claim = a.fields.find((x) => x.path === "myth.claim");
    expect(claim?.capChars).toBeUndefined();
    expect(claim && claim.words > claim.capWords).toBe(true);
    expect(a.cuts).toContain("myth.claim");
  });
});
