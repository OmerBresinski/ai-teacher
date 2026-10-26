import { describe, expect, test } from "bun:test";
import { slotBox } from "@tj/slides/diagrams";
import { getTheme } from "@tj/slides/themes";
import { freehandBan, LIVING_WORDS, livingOrProcessWord, PROCESS_WORDS } from "./body-figure";
import {
  type DrawerCall,
  drawWriterDiagram,
  layoutSlotProbe,
  type WriterDiagramAsk,
} from "./diagrams";

/*
 * TEACH-247 part ay: a freehand labelled drawing of an organism, a body part or a science process
 * is never drawn from primitives, whatever the drawer tags it. Objects and apparatus still draw.
 */
type S = Record<string, unknown>;

const ask = (shows: string, labels: string[]): WriterDiagramAsk => {
  const box = slotBox("KS3", "side");
  return {
    key: "figure",
    kind: "labelled-diagram",
    shows,
    labels,
    words: "A heading. A lead.",
    yearGroup: "Year 8",
    stage: "KS3",
    slot: { placement: "beside text", w: box.w, h: box.h, name: "side" },
  };
};

async function draw(a: WriterDiagramAsk, spec: S) {
  const events: S[] = [];
  const callDrawer: DrawerCall = async () => ({ out: spec });
  const r = await drawWriterDiagram(a, {
    callDrawer,
    drawerSystem: "system",
    fitActs: true,
    theme: getTheme(undefined as never, "KS3" as never),
    probe: layoutSlotProbe,
    log: (e) => events.push(e as S),
  });
  return { r, events };
}

/** A small drawing that parses and fits, with the drawer's subject (undefined: no tag). */
const spec = (subject: string | undefined, labels: string[], alt = "A drawing.") => ({
  kind: "labelled-diagram",
  ...(subject === undefined ? {} : { subject }),
  alt,
  canvas: "square",
  shapes: [{ type: "rect", x: 10, y: 10, w: 80, h: 80 }],
  labels: labels.map((text, k) => ({ text, at: [20 + k * 15, 50] })),
});

/** genlab run 20261026-172039 verify10, slide 2: the drawer's spec as it shipped (a stick plant). */
const VERIFY10_ASK = ask(
  "A green plant with carbon dioxide entering a leaf, water entering roots, and glucose and oxygen shown as products at the leaf. Arrows distinguish inputs from outputs without depicting a sequence.",
  ["Carbon dioxide", "Water", "Glucose", "Oxygen"],
);
const VERIFY10_SPEC = {
  alt: "A green plant with carbon dioxide and water entering, and glucose and oxygen leaving the leaf.",
  kind: "labelled-diagram",
  title: "Photosynthesis",
  canvas: "wide",
  labels: [
    { at: [35, 40], side: "top", text: "Carbon dioxide" },
    { at: [54, 88], side: "left", text: "Water" },
    { at: [123, 31], side: "top", text: "Glucose" },
    { at: [123, 58], side: "bottom", text: "Oxygen" },
  ],
  shapes: [
    {
      type: "line",
      dashed: false,
      points: [
        [80, 48],
        [80, 72],
      ],
    },
    { cx: 66, cy: 43, rx: 18, ry: 8, fill: "accent", type: "ellipse" },
    { cx: 94, cy: 43, rx: 18, ry: 8, fill: "accent", type: "ellipse" },
    {
      type: "line",
      dashed: false,
      points: [
        [80, 71],
        [69, 86],
      ],
    },
    {
      type: "line",
      dashed: false,
      points: [
        [80, 71],
        [80, 89],
      ],
    },
    {
      type: "line",
      dashed: false,
      points: [
        [80, 71],
        [92, 86],
      ],
    },
    { to: [53, 43], from: [20, 39], type: "arrow" },
    { to: [68, 82], from: [43, 93], type: "arrow" },
    { to: [137, 32], from: [106, 43], type: "arrow" },
    { to: [137, 57], from: [106, 47], type: "arrow" },
  ],
  subject: "abstract_or_process",
};

describe("the drawer path (TEACH-247 part ay)", () => {
  test("verify10's photosynthesis plant, tagged abstract_or_process, is not drawn", async () => {
    const { r, events } = await draw(VERIFY10_ASK, VERIFY10_SPEC);
    expect(r).toMatchObject({ via: "none", body: true });
    expect(r.spec).toBeUndefined();
    expect(r.models?.slice(0, 2)).toEqual(["photosynthesis", "plant_growth"]);
    expect(events).toContainEqual(
      expect.objectContaining({ ev: "body-figure", reason: "process", word: "photosynthesis" }),
    );
  });

  test("a stick-figure human tagged abstract_or_process is not drawn", async () => {
    const a = ask("A stick figure of a person standing, arms out", ["Head", "Arm", "Leg"]);
    const { r } = await draw(a, spec("abstract_or_process", ["Head", "Arm", "Leg"]));
    expect(r).toMatchObject({ via: "none", body: true, models: ["heart_circulation", "body_map"] });
  });

  test("a person with no tag is not drawn", async () => {
    const a = ask("A girl holding a kite", ["Girl", "Kite"]);
    const { r } = await draw(a, spec(undefined, ["Girl", "Kite"]));
    expect(r).toMatchObject({ via: "none", body: true });
  });

  test("a Bunsen burner with labelled parts is still drawn", async () => {
    const labels = ["Barrel", "Air hole", "Collar", "Gas tap", "Base"];
    const a = ask("A Bunsen burner with labelled parts", labels);
    const { r } = await draw(a, spec("object_or_machine", labels, "A Bunsen burner."));
    expect(r.via).toBe("drawer");
    expect(r.body).toBeUndefined();
    expect(r.spec).toMatchObject({ kind: "labelled-diagram", subject: "object_or_machine" });
  });

  test("a circuit with a cell, and a gas-syringe apparatus, are still drawn", async () => {
    for (const [shows, labels] of [
      ["A series circuit with a cell, a switch and two bulbs", ["Cell", "Switch", "Bulb", "Wire"]],
      [
        "A conical flask of acid and magnesium connected by a delivery tube to a gas syringe",
        ["Gas syringe", "Delivery tube", "Bung", "Conical flask"],
      ],
    ] as const) {
      const { r } = await draw(ask(shows, [...labels]), spec("object_or_machine", [...labels]));
      expect(r.via).toBe("drawer");
      expect(r.body).toBeUndefined();
    }
  });

  test("the water cycle goes to its library model, not a sketch", async () => {
    const a = ask("The water cycle over a hill and the sea", ["Evaporation", "Condensation"]);
    const { r } = await draw(a, spec("abstract_or_process", ["Evaporation", "Condensation"]));
    expect(r).toMatchObject({ via: "none", body: true, models: ["water_cycle"] });
  });
});

describe("freehandBan, the rule itself", () => {
  const ban = (shows: string, labels: string[] = [], subject = "object_or_machine") =>
    freehandBan({ shows, labels }, spec(subject, labels));

  test("the word lists are one exported constant each, lower case, no repeats", () => {
    for (const list of [LIVING_WORDS, PROCESS_WORDS] as readonly (readonly string[])[]) {
      expect(new Set(list).size).toBe(list.length);
      for (const w of list) expect(w).toBe(w.toLowerCase());
    }
    for (const w of ["person", "people", "child", "human", "body", "face", "hand", "leaf", "cell"])
      expect(LIVING_WORDS as readonly string[]).toContain(w);
  });

  test("whole words, plurals and any case", () => {
    expect(livingOrProcessWord("Two LEAVES on a stem")?.word).toBe("leaves");
    expect(livingOrProcessWord("Plant cells under a microscope")?.process).toBe(false);
    expect(livingOrProcessWord("Lungs and the trachea")?.word).toBe("lung");
    expect(livingOrProcessWord("The children line up")?.word).toBe("children");
    expect(livingOrProcessWord("Teeth in the lower jaw")?.word).toBe("teeth");
    // Not inside other words.
    for (const t of ["A linear scale", "Armour plates", "A plantation map", "Systematic sampling"])
      expect(livingOrProcessWord(t)).toBeUndefined();
  });

  test("the tag: living_body and a missing or unknown tag are banned on their own", () => {
    expect(ban("A volcano", [], "living_body")?.reason).toBe("tagged");
    expect(freehandBan({ shows: "A volcano" }, spec(undefined, []))?.reason).toBe("untagged");
    expect(ban("A volcano", [], "generic")?.reason).toBe("untagged");
    expect(ban("A volcano", [], "object_or_machine")).toBeUndefined();
  });

  test("processes are banned whatever the tag", () => {
    for (const p of [
      "Photosynthesis in a leaf",
      "Aerobic respiration",
      "The digestive system",
      "The carbon cycle",
    ])
      expect(ban(p, [], "abstract_or_process")).toBeDefined();
    expect(ban("The carbon cycle", [], "abstract_or_process")?.models).toEqual(["cycle_wheel"]);
  });

  test("edge cases: non-living uses still draw", () => {
    for (const shows of [
      "Laboratory apparatus for distillation",
      "A model of a cell phone and its parts",
      "A plant pot with drainage holes",
      "A factor tree of 60",
      "Child nodes in a binary tree",
      "Gear teeth meshing",
      "Isle of Man map",
      "Bar chart of people by age",
      "Population of fish in a lake",
      "A river from its source to its mouth",
      "A lever with its arm and pivot",
      "A cube with its faces, edges and vertices",
      "A clock face with the hour hand and minute hand",
      "Solving for the square root",
      "A stem-and-leaf diagram",
      "Two squares with the left-hand half shaded",
      "Camille's family tree: grandparents, parents, brother and sister",
      "A free-body diagram of a box on a slope",
      "A power plant turbine",
      "A computer mouse and keyboard",
      "Count each mouse click on the button",
      "A fence 12 feet long",
      "A room of 200 square feet",
      "A rocket with its nose cone and fins",
      "The mouth of a cave",
      "A bottle mouth and its cap",
      "The mouth of the volcano with its crater",
      "A motorway with its hard shoulder",
      "STEM careers in engineering",
    ])
      expect(ban(shows)).toBeUndefined();
  });

  test("edge cases: living uses are banned", () => {
    for (const shows of [
      "A plant cell with its nucleus",
      "A leaf in cross-section",
      "The human eye",
      "A Roman legionary with his shield",
      "A family portrait",
      "A dog and her puppies",
      "Root hair cells in soil",
      "A mouse in its nest",
      "A child's foot and its bones",
      "A flower stem and its leaves",
    ])
      expect(ban(shows)).toBeDefined();
    // A label alone names it.
    expect(ban("A cross-section", ["Petal", "Stamen"])).toBeDefined();
  });
});
