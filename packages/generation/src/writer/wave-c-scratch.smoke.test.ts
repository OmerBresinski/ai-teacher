// SCRATCH ONLY: each wave C writer shape materialises and lays out without a throw.
import { expect, test } from "bun:test";
import { getTheme } from "@tj/slides/themes";
import { materialise } from "./materialise";

const theme = getTheme("splash", "ks2");
const photo = (k: string) => ({
  status: "photo",
  photo: { src: `/files/${k}.jpg`, alt: k, aspect: 4 / 3 },
});
const pic = { shows: "a frog", must_see: ["frog"], subject: "generic" };
const model = {
  kind: "cycle",
  title: "Water cycle",
  steps: ["evaporation", "condensation", "rain"],
};
const slides: Record<string, any> = {
  worked: {
    template: "worked",
    heading: "Solve 2x + 3 = 11",
    lines: [
      { move: "Take 3", eq: "2x = 8", answer: false },
      { move: "Halve", eq: "x = 4", answer: true },
    ],
    check: "2(*4*) + 3 = 11",
    panel: null,
  },
  stages: {
    template: "stages",
    heading: "How a frog grows",
    accentWord: null,
    items: [
      { name: "Egg", line: "Laid in water", icon: null, picture: null },
      { name: "Tadpole", line: "Swims with a tail", icon: null, picture: null },
      { name: "Frog", line: "Lives on land", icon: null, picture: null },
    ],
  },
  reasons: {
    template: "reasons",
    heading: "Why did Rome fall?",
    lead: null,
    kind: "reasons",
    items: [
      { head: "Money", line: "Taxes were too high", icon: null },
      { head: "Army", line: "Soldiers were paid late", icon: null },
    ],
  },
  source: {
    template: "source",
    heading: "A letter home",
    form: "prose",
    from: "A soldier, 1916",
    extract: "We marched all night in the rain and the mud.",
    notes: [
      { anchor: "rain", label: "Weather", text: "Hard going" },
      { anchor: "mud", label: "Ground", text: "Trenches" },
    ],
    picture: null,
  },
  figure: {
    template: "figure",
    heading: "The water cycle",
    caption: "Water moves round and round",
    icon: "water",
    figure: pic,
  },
  myth: {
    template: "myth",
    heading: "Goldfish memory",
    myth: {
      opening: "vote",
      verdict: "myth",
      claim: "Goldfish forget in 3 seconds",
      fact: "They remember for months",
      factEm: null,
      proof: { line: "They learn feeding times", icons: null, picture: null },
    },
  },
  keycard: {
    template: "visual-text",
    fit: "key-card-fig",
    heading: "Habitats",
    lead: "A habitat is a home",
    points: [],
    icon: "home",
    cards: [
      {
        kind: "word",
        label: "Key word",
        term: "habitat",
        meaning: "where a living thing lives",
        examples: null,
        num: null,
        unit: null,
      },
    ],
    figure: pic,
  },
  stepmodel: {
    template: "steps",
    fit: "step-model",
    heading: "Step 1",
    step: { n: 1, do: "Heat the water", see: "Steam rises" },
    figure: model,
  },
};
for (const [k, s] of Object.entries(slides))
  test(`scratch: ${k} materialises and lays out`, () => {
    const m = materialise(s, {
      brief: { subject: "science", topic: "x", stage: "ks2" } as any,
      theme,
      stage: "ks2",
      index: 3,
      plan: { slides: [s] } as any,
      visual: photo,
    } as any);
    const flat = (es: any[]): any[] => es.flatMap((e) => [e, ...flat(e.children ?? [])]);
    const els = flat(m.slide.elements as any[]);
    expect(els.length).toBeGreaterThan(2);
  });

// SCRATCH: the wave C menu lines carry only generated numbers, in words, at every stage.
import { PILOT_PACKS } from "./pilot-pack";
import { waveCMenu, waveCWords } from "./wave-c-scratch";

for (const [ks, s] of [
  ["KS1", "KS1"],
  ["KS2", "KS2"],
  ["KS3", "KS3-5"],
] as const)
  test(`scratch: ${ks} wave C menu lines are in the v4.8 system, in words`, () => {
    const lines = waveCMenu(s);
    const sys = PILOT_PACKS["v4.8"].system[ks];
    for (const [name, line] of Object.entries(lines)) {
      expect(line.startsWith(`- ${name}: `)).toBe(true);
      expect(sys.split("\n")).toContain(line);
      // Characters only for the fact card's number (picture-text KEY_CAPS.num).
      expect(line.replace(/a number up to \d+ characters/, "")).not.toMatch(/character/);
    }
    expect(lines.myth).toContain(`the claim up to ${waveCWords(s).myth.claim} words`);
  });

// SCRATCH (pe-wavec2): the flow offers a why shape and plans a misconception slide only when one is held.
for (const ks of ["KS1", "KS2", "KS3"] as const)
  test(`scratch: ${ks} flow has the why shape and no standing misconception slot`, () => {
    const sys = PILOT_PACKS["v4.8"].system[ks];
    expect(sys).toContain("one big idea, reasons or causes, sequence,");
    expect(sys).toContain("(flow shape reasons or causes)");
    expect(sys).not.toContain("the misconception pupils most often hold here");
    expect(PILOT_PACKS["v4.8"].layouts.flowShapes).toContain("reasons or causes");
  });
