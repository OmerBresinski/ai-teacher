// Wave C offered to the production writer (TEACH-110 part v): each shape materialises and lays
// out, slot-fill accepts it against the v4.8 request, and the menu carries only generated numbers.

import { describe, expect, test } from "bun:test";
import { KEY_CAPS } from "@tj/slides/templates/picture-text";
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
    lead: "A habitat is a home.",
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
  test(`${k} materialises and lays out`, () => {
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

import { libSchema, WRITER_WORDS } from "../library/catalogue";
import { writerBundle } from "./bundle";
import { visualsOf } from "./materialise";
import { PILOT_PACKS, pilotRequest } from "./pilot-pack";
import { writerSchema } from "./schema";
import { slotFillArrival } from "./slot-fill";
import { WAVE_C_ROUTED_FITS, WHY_SHAPE, waveCMenu, waveCWords, withWaveCLibrary } from "./wave-c";

const STAGE_OF = { KS1: "KS1", KS2: "KS2", KS3: "KS3-5" } as const;
const request = (ks: keyof typeof STAGE_OF) =>
  pilotRequest(
    "v4.8",
    ks,
    writerSchema(STAGE_OF[ks], { min: 9, max: 12 }, writerBundle("base4f-p123"), { objectives: 3 }),
    (sc) => libSchema(sc, ["test-model"]),
  );
const libModel = {
  kind: "model",
  model: "test-model",
  intent: "the water heated",
  alt: "a kettle",
};
// Icons from the catalogue's enum or null (the smoke fixtures' "water" and "home" are free text).
const offered = {
  ...slides,
  figure: { ...slides.figure, icon: null },
  keycard: { ...slides.keycard, icon: null },
  stepmodel: { ...slides.stepmodel, figure: libModel },
};
delete (offered as Record<string, unknown>).source;

for (const ks of ["KS1", "KS2", "KS3"] as const) {
  const s = STAGE_OF[ks];
  test(`${ks}: wave C menu lines are in the v4.8 system, in words; source is not offered`, () => {
    const lines = waveCMenu(s);
    const sys = PILOT_PACKS["v4.8"].system[ks];
    for (const [name, line] of Object.entries(lines)) {
      expect(line.startsWith(`- ${name}: `)).toBe(true);
      // step-model's line is sent only with a library model (withWaveCLibrary), never in the pack text.
      if (name === "steps step-model") expect(sys.split("\n")).not.toContain(line);
      else expect(sys.split("\n")).toContain(line);
      // Characters only for the fact card's number (picture-text KEY_CAPS.num).
      expect(line.replace(/a number up to \d+ characters/, "")).not.toMatch(/character/);
    }
    expect(lines.myth).toContain(`the claim up to ${waveCWords(s).myth.claim} words`);
    expect(Object.keys(lines)).not.toContain("source");
    expect(sys).not.toContain("\n- source: ");
  });
  test(`${ks}: step-model's line joins the menu only with the Models list`, () => {
    const sys = PILOT_PACKS["v4.8"].system[ks];
    const line = waveCMenu(s)["steps step-model"] ?? "";
    expect(withWaveCLibrary(sys, s)).toBe(sys);
    const withModels = withWaveCLibrary(
      `${sys}\n${WRITER_WORDS.menuLine}\n\n${WRITER_WORDS.header}\n`,
      s,
    );
    expect(withModels.split("\n")).toContain(line);
    expect(withModels.indexOf(line)).toBeLessThan(withModels.indexOf("\nKey cards. "));
  });
  test(`${ks}: the flow has the why shape and no standing misconception slot`, () => {
    const sys = PILOT_PACKS["v4.8"].system[ks];
    expect(sys).toContain(`one big idea, ${WHY_SHAPE}, sequence,`);
    expect(sys).toContain(`(flow shape ${WHY_SHAPE})`);
    expect(sys).not.toContain("the misconception pupils most often hold here");
    expect(PILOT_PACKS["v4.8"].layouts.flowShapes).toContain(WHY_SHAPE);
  });
  test(`${ks}: every offered wave C slide arrives as written (no fit: missing, no cut)`, () => {
    const r = request(ks);
    for (const [k, slide] of Object.entries(offered)) {
      const a = slotFillArrival(structuredClone(slide), ks, r.schema, r.caps, true);
      expect({ k, breaches: a.breaches, cuts: a.cuts, over: a.over, route: a.route }).toEqual({
        k,
        breaches: [],
        cuts: [],
        over: [],
        route: "as-written",
      });
      expect(a.fields.length).toBeGreaterThan(0);
    }
  });
  test(`${ks}: routed fits and source are never sent; word caps, no characters, reach code`, () => {
    const r = request(ks);
    const sent = JSON.stringify(r.schema);
    for (const k of WAVE_C_ROUTED_FITS) expect(sent).not.toContain(`"#/$defs/${k}"`);
    expect(sent).not.toContain('"#/$defs/source"');
    expect(sent).toContain('"#/$defs/steps~step-model"');
    const name = r.caps?.$defs.stages.properties.items.items.properties.name;
    expect(name.maxWords).toBe(
      Math.max(...Object.values(waveCWords(s).stages).map((c) => (c as { name: number }).name)),
    );
    expect(name.maxLength).toBeUndefined();
    // Six pictured stages are not offered at KS2 or KS3 (KS1 measures no sixth stage at all).
    expect(Object.keys(waveCWords(s).stages)).not.toContain("6-pictures");
    // The step model's see shares do's two body lines, so it is capped at one line's words.
    const step = r.caps?.$defs["steps~step-model"].properties.step.properties;
    const see = step.see.anyOf.find((b: { type: string }) => b.type === "string");
    expect(see.maxWords).toBe(waveCWords(s).stepModel.doOneLine);
    expect(step.do.maxWords).toBe(waveCWords(s).stepModel.doTwoLines);
  });
  test(`${ks}: step-model's see shows only beside a one-line do, and tasks state their own facts`, () => {
    const line = waveCMenu(s)["steps step-model"] ?? "";
    expect(line).toContain(
      "The see line shows only when do and see each fit on one line: when see matters, keep do to one line; when do needs two lines, see is null.",
    );
    expect(line).toContain(
      `see ${waveCWords(s).stepModel.doOneLine === 1 ? "one word" : `up to ${waveCWords(s).stepModel.doOneLine} words`}.`,
    );
    expect(PILOT_PACKS["v4.8"].system[ks]).toContain(
      "Each question and task states in its own words every fact and number its answer needs, even when a picture on its slide shows them too",
    );
  });
}

test("a wave C field over its word cap is a cut; an empty stage line is allowed", () => {
  const r = request("KS2");
  const claim = Array.from({ length: 40 }, () => "word").join(" ");
  const myth = structuredClone(slides.myth);
  myth.myth.claim = claim;
  expect(slotFillArrival(myth, "KS2", r.schema, r.caps, true).cuts).toContain("myth.claim");
  const st = structuredClone(slides.stages);
  st.items[1].line = "";
  expect(slotFillArrival(st, "KS2", r.schema, r.caps, true).route).toBe("as-written");
});

test("a library model on figure-slide and step-model is asked of the diagram library", () => {
  const vctx = {
    brief: { subject: "science", topic: "x", stage: "ks2" },
    theme,
    stage: "ks2",
    plan: { slides: [] },
  } as unknown as Parameters<typeof visualsOf>[2];
  for (const slide of [
    { ...slides.figure, figure: libModel },
    { ...slides.stepmodel, figure: libModel },
  ]) {
    const asks = visualsOf(slide, 3, vctx);
    expect(asks.map((a) => [a.key, a.type, (a as { kind?: string }).kind])).toEqual([
      ["figure", "diagram", "model"],
    ]);
  }
});

test("picture-text takes the key cards and icon; a step model keeps its step beside the model", async () => {
  const { toInput } = await import("./materialise");
  const ctx = {
    brief: { subject: "science", topic: "x", stage: "ks2" },
    theme,
    stage: "ks2",
    index: 3,
    plan: { slides: [] },
    visual: (k: string) =>
      k === "figure" ? { status: "diagram", spec: { kind: "model" } } : photo(k),
  } as unknown as Parameters<typeof toInput>[1];
  const kc = toInput(slides.keycard, { ...ctx, visual: photo } as typeof ctx) as unknown as {
    template: string;
    pictureText?: { icon?: string; cards?: Record<string, unknown>[] };
  };
  expect(kc.template).toBe("picture-text");
  expect(kc.pictureText?.icon).toBe("home");
  expect(kc.pictureText?.cards?.[0]).toEqual({
    kind: "word",
    label: "Key word",
    term: "habitat",
    meaning: "where a living thing lives",
  });
  const sm = toInput({ ...slides.stepmodel, figure: libModel }, ctx) as unknown as {
    template: string;
    step?: unknown;
    figure?: unknown;
  };
  expect(sm.template).toBe("steps");
  expect(sm.step).toEqual({ n: 1, do: "Heat the water", see: "Steam rises" });
  expect(sm.figure).toBeDefined();
});

describe("wave C caps at the slide's own count (review, 19 Oct 2026)", () => {
  const r = request("KS2");
  const W = waveCWords("KS2");
  const arrive = (s: unknown) =>
    slotFillArrival(structuredClone(s) as never, "KS2", r.schema, r.caps, true);
  const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
  test("a key card's over-long term is a cut; the num is held in characters", () => {
    const kc = structuredClone(offered.keycard);
    kc.cards[0].term = words(KEY_CAPS.term + 2);
    expect(arrive(kc).cuts).toContain("cards[0].term");
    const caps = r.caps?.$defs["visual-text~key-card-fig"].properties.cards.items.properties;
    expect(caps.label.maxWords).toBe(KEY_CAPS.label);
    expect(caps.meaning.anyOf[0].maxWords).toBe(KEY_CAPS.meaning);
    expect(caps.num.anyOf[0].maxLength).toBe(KEY_CAPS.num);
  });
  // TEACH-247 part bq: stages and reasons fields are judged in their cell's characters (`hardMax`).
  const chars = (n: number) => "x".repeat(n);
  const roomOf = (slide: unknown, path: string) =>
    arrive(slide).fields.find((f) => f.path === path)?.capChars ?? 0;
  test("a stage line fits three stages but not five: checked at five", () => {
    const at = (count: number, line: string) => {
      const st = structuredClone(slides.stages);
      st.items = Array.from({ length: count }, (_, i) => ({
        name: `Step${i}`,
        line,
        icon: null,
        picture: null,
      }));
      return st;
    };
    const n = roomOf(at(5, "a"), "items[0].line") + 1;
    expect(n).toBeLessThanOrEqual(roomOf(at(3, "a"), "items[0].line"));
    expect(arrive(at(3, chars(n))).cuts).toEqual([]);
    expect(arrive(at(5, chars(n))).cuts).toContain("items[0].line");
  });
  test("a reasons count no cell offers is a cut; the heading is held to the question", () => {
    const rs = structuredClone(slides.reasons);
    rs.heading = chars(roomOf(rs, "heading") + 1);
    expect(roomOf(slides.reasons, "heading")).toBeGreaterThan(0);
    expect(arrive(rs).cuts).toContain("heading");
  });
  test("the myth heading and factEm are capped; step n is one digit", () => {
    const my = structuredClone(slides.myth);
    my.heading = words(W.myth.title + 1);
    expect(arrive(my).cuts).toContain("heading");
    const n = r.schema.$defs["steps~step-model"].properties.step.properties.n.anyOf[0];
    expect([n.minimum, n.maximum]).toEqual([1, 9]);
  });
});
