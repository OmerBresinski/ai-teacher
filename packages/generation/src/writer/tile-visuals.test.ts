import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getTheme } from "@tj/slides/themes";
import { sampleBriefLesson } from "../testing";
import { withActivities } from "./activities";
import { tilesAsPictures } from "./fallbacks";
import fixture from "./fixtures/activities/y1-animals.json" with { type: "json" };
import { materialise, type Plan, tileDiagramKeys, type VisualState } from "./materialise";
import { TILE_VISUALS_DEFAULT, writerSchema } from "./schema";
import { validate } from "./strict-subset";

/*
 * TEACH-75 part d: compare cards, sequence stages and a hinge may carry a diagram. The widened
 * schema still takes every older output; a drawn tile is shown, a lost one is never an empty tile.
 */
type S = Record<string, unknown>;
type J = Record<string, unknown>;

const flow = (a: string, b: string) => ({
  kind: "flow",
  shows: `${a} becomes ${b}`,
  alt: `${a} then ${b}.`,
  title: null,
  nodes: [a, b],
  links: [{ from: 0, to: 1, label: null }],
});
const pic = { shows: "an artery", must_see: ["artery"], subject: "generic" };
const vessel = (outer: number, inner: number) => ({
  kind: "labelled-diagram",
  alt: "A cross-section of a blood vessel.",
  shapes: [
    { type: "circle", cx: 50, cy: 50, r: outer, fill: "accent" },
    { type: "circle", cx: 50, cy: 50, r: inner, fill: "surface" },
  ],
  labels: [],
});
const compare: S = {
  template: "compare",
  heading: "Three kinds of blood vessel",
  columns: [
    { label: "Artery", text: "Thick wall.", picture: flow("Heart", "Body") },
    { label: "Vein", text: "Thin wall.", picture: flow("Body", "Heart") },
    { label: "Capillary", text: "One cell thick.", picture: flow("Artery", "Vein") },
  ],
};
const sequence: S = {
  template: "picture-sequence",
  heading: "A frog grows",
  sequence: [
    { caption: "Spawn", diagram: flow("Egg", "Tadpole") },
    { ...pic, caption: "Tadpole" },
  ],
};
const hinge = (figure: unknown): S => ({
  template: "hinge",
  heading: "Quick check",
  stem: "Which vessel is drawn?",
  options: ["Artery", "Vein", "Capillary"],
  correct: 1,
  figure,
});

describe("the tile-visual schema", () => {
  const SLIDES = (fixture as { brief: { slides: { min: number; max: number } } }).brief.slides;
  const on = writerSchema("KS1", SLIDES, undefined, { tileVisuals: true }) as J;
  const defs = on.$defs as Record<string, J>;

  test("is off by default: master's schema byte for byte", () => {
    expect(TILE_VISUALS_DEFAULT).toBe(false);
    expect(JSON.stringify(writerSchema("KS1", SLIDES))).toBe(
      JSON.stringify(writerSchema("KS1", SLIDES, undefined, { tileVisuals: false })),
    );
    expect(JSON.stringify(writerSchema("KS1", SLIDES))).not.toBe(JSON.stringify(on));
  });

  test("older outputs still validate (round trip)", () => {
    expect(validate(withActivities(on, "KS1"), (fixture as { main: unknown }).main)).toEqual([]);
    expect(
      validate(
        defs.compare as J,
        {
          ...compare,
          columns: [
            { label: "a", text: "b", picture: pic },
            { label: "c", text: "d", picture: null },
          ],
        },
        on,
      ),
    ).toEqual([]);
    expect(
      validate(
        defs["picture-sequence"] as J,
        {
          ...sequence,
          sequence: [
            { ...pic, caption: "a" },
            { ...pic, caption: "b" },
          ],
        },
        on,
      ),
    ).toEqual([]);
  });

  test("diagram tiles and a hinge figure validate", () => {
    expect(validate(defs.compare as J, compare, on)).toEqual([]);
    expect(validate(defs["picture-sequence"] as J, sequence, on)).toEqual([]);
    for (const f of [null, pic, flow("a", "b")])
      expect(validate(defs.hinge as J, hinge(f), on)).toEqual([]);
  });
});

describe("tile diagrams on the writer's layout", () => {
  const brief = { ...sampleBriefLesson().brief, keyStage: "KS3" } as never;
  const base = {
    brief,
    theme: getTheme(undefined as never, "KS3" as never),
    stage: "KS3" as never,
  };
  const plan = { slides: [] } as unknown as Plan;
  const run = (s: S, visual: (k: string) => VisualState) =>
    materialise(s, { ...base, index: 0, plan, visual });
  const drawn = (k: string): VisualState =>
    ({ status: "diagram", spec: vessel(40, k === "col.0" ? 14 : 30) }) as VisualState;
  const diagrams = (els: { name?: string }[]) => els.filter((e) => e.name === "Diagram").length;

  test("the keys are the drawn tiles only", () => {
    expect(tileDiagramKeys(compare)).toEqual(["col.0", "col.1", "col.2"]);
    expect(tileDiagramKeys(sequence)).toEqual(["seq.0"]);
    expect(tileDiagramKeys(hinge(null))).toEqual([]);
  });

  test("three drawn vessels are three drawings, nothing lost", () => {
    const m = run(compare, drawn);
    expect(m.lost).toBeUndefined();
    expect(diagrams(m.slide.elements as never)).toBe(3);
  });

  test("one failed tile: every card goes without, never an empty band", () => {
    const m = run(compare, (k) => (k === "col.1" ? { status: "failed" } : drawn(k)));
    expect(diagrams(m.slide.elements as never)).toBe(0);
    const labels = (m.slide.elements as { name?: string }[]).filter((e) => e.name === "Label");
    expect(labels).toHaveLength(3);
  });

  test("a hinge shows its figure beside the options", () => {
    const m = run(hinge(flow("a", "b")), () => drawn("figure"));
    expect(diagrams(m.slide.elements as never)).toBe(1);
  });

  test("a lost tile is asked again as a picture of the same thing", () => {
    const thing = {
      kind: "labelled-diagram",
      shows: "a vein in cross-section",
      labels: ["wall", "lumen"],
    };
    const cols = (compare.columns as S[]).map((c, k) => (k === 1 ? { ...c, picture: thing } : c));
    const s = tilesAsPictures({ ...compare, columns: cols }, ["col.1"]) as S;
    const pic = (s.columns as S[])[1]?.picture as S;
    expect(pic.shows).toBe("a vein in cross-section");
    expect(pic.must_see).toEqual(["wall", "lumen"]);
    expect((s.columns as S[])[0]?.picture).toEqual(cols[0]?.picture);
    // A flow is not a thing a photo can show: the slide takes its words-only form instead.
    expect(tilesAsPictures(compare, ["col.1"])).toBeUndefined();
  });
});

describe("photo-only replays are unchanged", () => {
  const dir = join(import.meta.dir, "fixtures/writer-outputs");
  test("no fixture lesson has a tile diagram or a lost tile", () => {
    const brief = { ...sampleBriefLesson().brief, keyStage: "KS2" } as never;
    const base = {
      brief,
      theme: getTheme(undefined as never, "KS2" as never),
      stage: "KS2" as never,
    };
    let n = 0;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const out = JSON.parse(readFileSync(join(dir, f), "utf8")) as { text?: string };
      if (!out.text) continue;
      const plan = JSON.parse(out.text) as Plan;
      plan.slides.forEach((s, i) => {
        if (!s) return;
        expect(tileDiagramKeys(s)).toEqual([]);
        const m = materialise(s, { ...base, index: i, plan, visual: () => ({ status: "failed" }) });
        expect(m.lost).toBeUndefined();
        n++;
      });
    }
    expect(n).toBeGreaterThan(20);
  });
});
