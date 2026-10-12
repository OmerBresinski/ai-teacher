import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fallbackIsBody, livingBodyOf, routeFreehandBodies } from "./body-figure";
import type { DrawerCall } from "./diagrams";
import type { Brief } from "./fixes";
import { normalise, type VisualAsk } from "./materialise";
import { recordedVisuals, replayServices } from "./replay-fixture";
import { runWriter } from "./stage";

/*
 * TEACH-247 part ad (STICKFIG): a labelled drawing of a living body is never drawn freehand. It
 * goes to a library model on a full slide when the lesson has one, else to a picture.
 */
type S = Record<string, unknown>;

/** WRITERBENCH raw/S slide 3 ("Three parts work together"), as the writer wrote it. */
const HEART: S = {
  template: "visual-text",
  heading: "Three parts work together",
  lead: "The circulatory system moves blood around your body.",
  points: [
    { label: "Heart", text: "A muscle that pumps blood." },
    { label: "Blood", text: "Carries oxygen and nutrients." },
    { label: "Blood vessels", text: "Tubes that blood travels through." },
  ],
  figure: {
    kind: "labelled-diagram",
    shows:
      "A simplified human outline with a heart in the chest and a continuous network of blood vessels reaching the arms, legs and head; an enlarged vessel section shows blood inside.",
    labels: ["Heart", "Blood vessels", "Blood"],
  },
};

/** The other four lessons STICKFIG found drawing a living thing from primitives. */
const OTHERS: Record<string, { shows: string; labels: string[] }> = {
  // BAKEOFF/arm-c/smoke1 y1-science-animals-young (drawer request text).
  "Y1 animals and their young": {
    shows:
      "Naturalistic animal comparison: adult dog on left, small puppy on right, same breed and coat colour.",
    labels: ["dog", "puppy"],
  },
  // BAKEOFF round7, Y4 history.
  "Y4 Roman legionary": {
    shows:
      "a historically grounded reconstruction of a Roman legionary around AD 43, holding a curved rectangular shield and a javelin",
    labels: ["shield", "javelin", "helmet"],
  },
  // The Y1 lesson's third objective (LAYOUT-TEST ZV): a tadpole changing into a frog.
  "Y1 frog and tadpole": {
    shows: "A tadpole beside the adult frog it grows into, at the same scale.",
    labels: ["tadpole", "frog"],
  },
  // Y12 psychology, multi-store model.
  "Y12 eye and ear": {
    shows:
      "An eye and an ear receiving separate inputs, leading to separate visual and auditory sensory stores",
    labels: ["Eye", "Ear", "Iconic store", "Echoic store"],
  },
};

const slideOf = (f: S, template = "visual-text"): S => ({
  template,
  heading: "A heading",
  lead: "A lead.",
  ...(template === "visual-text" ? { points: ["One point", "Another point"] } : {}),
  figure: f,
});

describe("freehand bodies are not drawn (TEACH-247 part ad)", () => {
  test("the heart 'three parts' slide routes to a picture, never a drawn figure", () => {
    const r = routeFreehandBodies(HEART, ["heart_circulation", "body_map"]);
    expect(r.routes).toEqual([{ key: "figure", to: "picture", why: "person: human" }]);
    const f = r.slide.figure as S;
    expect(f.kind).toBeUndefined();
    expect(f.shows).toBe((HEART.figure as S).shows);
    expect(f.must_see).toEqual(["Heart", "Blood vessels", "Blood"]);
    expect(normalise(r.slide).template).toBe("picture-text");
    // The writer's words are kept as written.
    expect(r.slide.points).toEqual(HEART.points);
  });

  test("on a full slide it takes the lesson's heart model; without one, a picture", () => {
    const full = { ...HEART, template: "big-visual", points: undefined };
    const m = routeFreehandBodies(full, ["heart_circulation"]);
    expect(m.routes[0]).toMatchObject({ to: "model", model: "heart_circulation" });
    expect(m.slide.figure).toMatchObject({ kind: "model", model: "heart_circulation" });
    const p = routeFreehandBodies(full, []);
    expect(p.routes[0]?.to).toBe("picture");
    expect(normalise(p.slide).template).toBe("big-picture");
  });

  for (const [name, f] of Object.entries(OTHERS))
    test(`${name}: a picture, never a drawn figure`, () => {
      const r = routeFreehandBodies(slideOf({ kind: "labelled-diagram", ...f }), []);
      expect(r.routes.map((x) => x.to)).toEqual(["picture"]);
      expect(normalise(r.slide).template).toBe("picture-text");
      expect((r.slide.figure as S).must_see).toEqual(f.labels.slice(0, 4));
    });

  test("a body model asked for on a side slot is a picture, not the drawer's fallback", () => {
    const r = routeFreehandBodies(
      slideOf({ kind: "model", model: "heart_circulation", intent: "heart and blood vessels" }),
      ["heart_circulation"],
    );
    expect(r.routes[0]?.to).toBe("picture");
    // A side-slot model with a base kind (a cycle) keeps its drawer route.
    const c = slideOf({ kind: "model", model: "life_cycle", intent: "a frog's life cycle" });
    expect(routeFreehandBodies(c, []).slide).toBe(c);
    expect(fallbackIsBody("heart_circulation", "anything")).toBe(true);
    expect(fallbackIsBody("fractions", "one half shaded")).toBe(false);
  });

  test("a compare card drawing an animal becomes its picture", () => {
    const s: S = {
      template: "compare",
      heading: "Adult and young",
      columns: [
        {
          label: "Cat",
          picture: { kind: "labelled-diagram", shows: "an adult cat", labels: ["cat"] },
        },
        { label: "Kitten", picture: { kind: "labelled-diagram", shows: "a kitten", labels: [] } },
      ],
    };
    const r = routeFreehandBodies(s, []);
    expect(r.routes.map((x) => x.key)).toEqual(["col.0", "col.1"]);
    expect((r.slide.columns as S[]).every((c) => !("kind" in (c.picture as S)))).toBe(true);
  });

  test("words that only look like a body leave the drawing alone", () => {
    for (const shows of [
      "A lake as a body of water fed by two rivers",
      "How a governing body passes a law",
      "A celestial body orbiting a star",
      "A hurricane cross-section with the eye of the storm at the centre",
      "An ear of wheat with its grains",
      "A plant cell with its cell wall, nucleus and chloroplasts",
      "An animal cell with a nucleus and cell membrane",
      "A coal power plant: boiler, turbine and generator",
      "A family tree centred on a child, with parents and grandparents above",
      "A food chain: grass, rabbit and fox",
      "A bird's-eye view of a Roman fort",
      "The market square at the heart of the town",
      "A clock face with an hour hand and a minute hand",
      "A circuit with a cell, a switch and a bulb",
      "A volcano cross-section with a magma chamber and vent",
      "A lever with a load, an effort and a pivot",
      "A robot arm lifting a box",
      "Three memory-store boxes: sensory register, STM and LTM",
      "Gas and nutrient exchange between a capillary and body cells",
    ]) {
      expect([shows, livingBodyOf(shows)]).toEqual([shows, undefined]);
      const s = slideOf({ kind: "labelled-diagram", shows, labels: ["A", "B"] });
      expect(routeFreehandBodies(s, []).slide).toBe(s);
    }
  });

  test("the lab corpus: bodies routed, every other labelled drawing unchanged", () => {
    const corpus = JSON.parse(
      readFileSync(join(import.meta.dir, "fixtures/labelled-corpus.json"), "utf8"),
    ) as { shows: string; labels: string[] }[];
    const routed: number[] = [];
    let unchanged = 0;
    corpus.forEach((f, i) => {
      const s = slideOf({ kind: "labelled-diagram", ...f });
      const r = routeFreehandBodies(s, []);
      if (r.routes.length) routed.push(i);
      else if (r.slide === s) unchanged++;
    });
    // 193 unique writer asks in scratchpad/quality-prd/lab/rounds (12 Oct 2026): 33 living bodies
    // (hearts in a body, a wrist, an eye and ear, people and portraits, a plant, a puppy, soldiers),
    // 160 others (apparatus, shapes, counters, family trees, memory stores, cells) left as they were.
    expect(corpus.length).toBe(193);
    expect(routed.length).toBe(33);
    expect(unchanged).toBe(160);
    expect(routed).toEqual([
      0, 1, 2, 3, 4, 5, 6, 8, 19, 56, 57, 64, 80, 82, 91, 92, 99, 100, 103, 111, 127, 128, 136, 137,
      140, 144, 165, 169, 179, 187, 188, 191, 192,
    ]);
  });
});

describe("writer stage: a freehand body never reaches the drawer", () => {
  const B = "y2-maths-halves-quarters";
  const DIR = join(import.meta.dir, "fixtures/replay", B);
  const read = (f: string) => readFileSync(join(DIR, f), "utf8");

  test("the heart slide is planned as a picture: no labelled-diagram drawer call", async () => {
    const brief = JSON.parse(read("brief.json")) as Brief;
    const objectives = (
      JSON.parse(read("objectives.json")) as { objectives: { teacher: string }[] }
    ).objectives.map((o) => o.teacher);
    const main = JSON.parse(read("main.json")) as { text: string; finishReason?: string };
    const out = JSON.parse(main.text) as { slides: S[] };
    out.slides[0] = structuredClone(HEART);
    const asked: string[] = [];
    const callDrawer: DrawerCall = async (req) => {
      asked.push(req.user);
      return { out: undefined };
    };
    const events: S[] = [];
    const placed: VisualAsk[][] = [];
    await runWriter({
      brief,
      objectives,
      services: { ...replayServices(B), log: (e) => events.push(e as S) },
      visual: recordedVisuals(B),
      recordedWriter: { text: JSON.stringify(out), finishReason: main.finishReason ?? null },
      drawDiagrams: { callDrawer },
      onAsks: (i, a) => {
        if (i === 2) placed.push(a);
      },
    });
    // The fixture's own maths drawings still go to the drawer; the heart outline never does.
    expect(asked.some((u) => /human outline/.test(u))).toBe(false);
    expect(placed.at(-1)).toMatchObject([
      { key: "picture", type: "photo", mustSee: ["Heart", "Blood vessels", "Blood"] },
    ]);
    expect(events.filter((e) => e.ev === "body-figure")).toContainEqual({
      ev: "body-figure",
      slide: 3,
      key: "figure",
      to: "picture",
      why: "person: human",
    });
    expect(events.some((e) => e.ev === "diagram-call" && e.slide === 3)).toBe(false);
  });
});
