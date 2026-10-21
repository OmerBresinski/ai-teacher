import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { slotBox } from "@tj/slides/diagrams";
import { getTheme } from "@tj/slides/themes";
import { loadModel } from "../library/render";
import {
  type DrawerCall,
  drawWriterDiagram,
  layoutSlotProbe,
  type WriterDiagramAsk,
} from "./diagrams";
import type { Brief } from "./fixes";
import type { VisualAsk, VisualState } from "./materialise";
import { recordedVisuals, replayServices } from "./replay-fixture";
import { runWriter } from "./stage";

/*
 * TEACH-247 part ad (STICKFIG): the drawer names what a labelled drawing is of (`subject`); a
 * living body is never drawn from shapes. The drawer's field is mocked here: these tests hold the
 * routing on the field, not the drawer's judgement (the prompt-engineer owns its wording).
 */
type S = Record<string, unknown>;

/** A labelled drawing that parses and fits a side slot, with the drawer's subject. */
const drawn = (subject: string, labels: string[]) => ({
  kind: "labelled-diagram",
  subject,
  alt: "A drawing.",
  canvas: "square",
  shapes: [{ type: "rect", x: 10, y: 10, w: 80, h: 80 }],
  labels: labels.map((text, k) => ({ text, at: [20 + k * 20, 50] })),
});

const ask = (shows: string, labels = ["Part one", "Part two"]): WriterDiagramAsk => {
  const box = slotBox("KS2", "side");
  return {
    key: "figure",
    kind: "labelled-diagram",
    shows,
    labels,
    words: "A heading. A lead.",
    yearGroup: "Year 6",
    stage: "KS2",
    slot: { placement: "beside text", w: box.w, h: box.h, name: "side" },
  };
};

async function draw(shows: string, subject: string) {
  const schemas: S[] = [];
  const events: S[] = [];
  const callDrawer: DrawerCall = async (req) => {
    schemas.push(req.schema as S);
    return { out: drawn(subject, ["Part one", "Part two"]) };
  };
  const r = await drawWriterDiagram(ask(shows), {
    callDrawer,
    drawerSystem: "system",
    fitActs: true,
    theme: getTheme(undefined as never, "KS2" as never),
    probe: layoutSlotProbe,
    log: (e) => events.push(e as S),
  });
  return { r, schemas, events };
}

/** PR #514's review probes, and the lessons STICKFIG found, with the subject the drawer gives. */
const PROBES: [string, string][] = [
  // Not bodies: a word list rerouted these.
  ["A factor tree of 60", "abstract_or_process"],
  ["Child nodes in a binary tree", "abstract_or_process"],
  ["A tree ring cross-section", "object_or_machine"],
  ["Gear teeth meshing", "object_or_machine"],
  ["A saw tooth profile", "object_or_machine"],
  ["A kidney bean seed", "object_or_machine"],
  ["Isle of Man map", "place_or_map"],
  ["Bar chart of people by age", "abstract_or_process"],
  ["Population of fish in a lake", "abstract_or_process"],
  // The Y12 sensory register: its eye and ear feed memory-store boxes, a model of a process.
  [
    "An eye and an ear receiving separate inputs, leading to separate visual and auditory sensory stores",
    "abstract_or_process",
  ],
  // Bodies: a word list missed these.
  ["A camel with its hump and wide feet", "living_body"],
  ["A monkey in a tree", "living_body"],
  ["A brown bear", "living_body"],
  ["Ants carrying a leaf", "living_body"],
  ["An Anglo-Saxon warrior with a shield", "living_body"],
  ["A pharaoh in a headdress", "living_body"],
  ["Layers of the skin", "living_body"],
  // STICKFIG's five lessons.
  [
    "A simplified human outline with a heart in the chest and a continuous network of blood vessels reaching the arms, legs and head",
    "living_body",
  ],
  ["Adult dog on left, small puppy on right", "living_body"],
  ["A tadpole beside the adult frog it grows into", "living_body"],
  ["A Roman legionary around AD 43, holding a curved shield and a javelin", "living_body"],
];

describe("labelled drawings route on the drawer's subject (TEACH-247 part ad)", () => {
  for (const [shows, subject] of PROBES)
    test(`${subject}: ${shows.slice(0, 50)}`, async () => {
      const { r, schemas, events } = await draw(shows, subject);
      // One drawer call, asked to name the subject.
      expect(schemas.length).toBe(1);
      expect(schemas[0]?.required).toContain("subject");
      if (subject === "living_body") {
        expect(r).toMatchObject({ via: "none", body: true });
        expect(r.spec).toBeUndefined();
        expect(events.some((e) => e.ev === "body-figure")).toBe(true);
      } else {
        expect(r.via).toBe("drawer");
        expect(r.spec).toMatchObject({ kind: "labelled-diagram", subject });
        expect(r.body).toBeUndefined();
      }
    });

  test("a stored spec with no subject still draws (lessons made before the field)", async () => {
    const { r } = await draw("A volcano", undefined as never);
    expect(r.via).toBe("drawer");
  });

  test("the lab corpus: only drawings named living_body are withheld", async () => {
    const corpus = JSON.parse(
      readFileSync(join(import.meta.dir, "fixtures/labelled-corpus.json"), "utf8"),
    ) as { shows: string; labels: string[] }[];
    // 193 unique writer asks under scratchpad/quality-prd/lab/rounds (12 Oct 2026). The bodies,
    // read one by one: hearts in a body, a wrist, people and portraits, a plant, a puppy, a
    // legionary, soldiers, and the lungs-heart-leg circulation model.
    const BODIES = new Set([
      0, 1, 2, 3, 4, 5, 6, 8, 56, 57, 64, 80, 82, 91, 92, 99, 100, 103, 111, 127, 128, 136, 137,
      140, 144, 165, 169, 179, 187, 188, 191, 192,
    ]);
    let withheld = 0;
    let drew = 0;
    for (const [i, f] of corpus.entries()) {
      const { r } = await draw(f.shows, BODIES.has(i) ? "living_body" : "object_or_machine");
      if (r.body) withheld++;
      else if (r.spec) drew++;
    }
    expect(corpus.length).toBe(193);
    expect(withheld).toBe(32);
    expect(drew).toBe(161);
  });
});

describe("writer stage: a living body is a picture or a model, never shapes", () => {
  const B = "y2-maths-halves-quarters";
  const DIR = join(import.meta.dir, "fixtures/replay", B);
  const read = (f: string) => readFileSync(join(DIR, f), "utf8");
  const HEART = {
    shows:
      "A simplified human outline with a heart in the chest and a continuous network of blood vessels reaching the arms, legs and head; an enlarged vessel section shows blood inside.",
    labels: ["Heart", "Blood vessels", "Blood", "Lungs", "A"],
  };

  async function run(full: boolean) {
    const brief = JSON.parse(read("brief.json")) as Brief;
    const objectives = (
      JSON.parse(read("objectives.json")) as { objectives: { teacher: string }[] }
    ).objectives.map((o) => o.teacher);
    const main = JSON.parse(read("main.json")) as { text: string; finishReason?: string };
    const out = JSON.parse(main.text) as { slides: S[] };
    out.slides[0] = {
      template: full ? "big-visual" : "visual-text",
      heading: "Three parts work together",
      lead: "The circulatory system moves blood around your body.",
      ...(full ? {} : { points: ["The heart pumps blood.", "Blood vessels carry it."] }),
      figure: { kind: "labelled-diagram", ...HEART },
    };
    const heart = await loadModel("heart_circulation");
    const fills: string[] = [];
    const drawerKinds: string[] = [];
    const callDrawer: DrawerCall = async (req) => {
      if (req.system.startsWith("Set the parameters")) {
        fills.push(req.user);
        return { out: heart?.presets[0]?.params };
      }
      const kind = /Kind: ([a-z-]+)/.exec(req.user)?.[1] ?? "";
      drawerKinds.push(kind);
      return {
        out: /human outline/.test(req.user) ? drawn("living_body", HEART.labels) : undefined,
      };
    };
    const rec = recordedVisuals(B);
    const placed = new Set<string>();
    const asked: VisualAsk[][] = [];
    const visual = (i: number, key: string, a: VisualAsk): VisualState =>
      placed.has(`${i}:${key}`)
        ? {
            status: "photo",
            photo: { src: "/files/test/heart.png", alt: key, aspect: 1.5, request: key },
          }
        : rec(i, key, a);
    const events: S[] = [];
    const res = await runWriter({
      brief,
      objectives,
      services: { ...replayServices(B), log: (e) => events.push(e as S) },
      visual,
      recordedWriter: { text: JSON.stringify(out), finishReason: main.finishReason ?? null },
      drawDiagrams: { callDrawer },
      library: true,
      placeMore: async (i, more) => {
        asked.push(more);
        for (const a of more) placed.add(`${i}:${a.key}`);
      },
    });
    const els = (res.slides[2]?.elements ?? []) as S[];
    return { els, events, fills, drawerKinds, asked };
  }

  test("side slot: one drawer call, nothing drawn, the picture is placed with every label", async () => {
    const { els, events, drawerKinds, asked } = await run(false);
    expect(drawerKinds.filter((k) => k === "labelled-diagram").length).toBeGreaterThan(0);
    expect(events).toContainEqual(
      expect.objectContaining({ ev: "body-figure", slide: 3, to: "picture" }),
    );
    expect(els.some((e) => e.name === "Diagram")).toBe(false);
    expect(els.find((e) => e.type === "image")?.src).toBe("/files/test/heart.png");
    // Every label, the fifth and the one-letter one included.
    expect(asked.flat().find((a) => a.type === "photo")).toMatchObject({
      mustSee: HEART.labels,
    });
  });

  test("full slot with the heart model in the lesson's catalogue: the model draws", async () => {
    const { els, events, fills } = await run(true);
    expect(fills.length).toBeGreaterThan(0);
    expect(fills[0]).toContain("human outline");
    expect(
      events.some((e) => e.ev === "diagram-done" && e.slide === 3 && e.via === "library" && e.body),
    ).toBe(true);
    expect(els.some((e) => e.name === "Diagram")).toBe(true);
  });
});
