import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BODY_STACKS, fitsMeasured, hasAdvances, LIMITS } from "@tj/slides/diagrams";
import { FONT_STACKS } from "@tj/slides/fonts";
import { endDrawThread } from "../library/guard";
import type { DrawerCall } from "./diagrams";
import type { Brief } from "./fixes";
import { wordsOf } from "./materialise";
import { recordedVisuals, replayServices } from "./replay-fixture";
import { runWriter } from "./stage";

/*
 * TEACH-247 part cn: v4.21a Y8 photosynthesis (genlab run 20261102-171851, s4 "The word
 * equation", visual-text fit points-1-key-fig). The writer planned a flow beside a key card; its
 * link "photosynthesis" failed the width check (`links.0.label: too wide ... 140 points`), the
 * drawer's two tries put the same word on the arrow and failed the same way, and the slide shipped
 * text-only with its right half empty (`diagram-done ok:false via:none`). The word is 131 points or
 * less in every theme's body face; the check refused it for Geist, the app's own face, which no
 * theme sets slide text in and which has no metrics table (a 0.62 em guess: 156 points).
 */

/** The run's slide 4, exactly as the writer wrote it (debug.json, kind writer-output). */
const SLIDE4 = {
  template: "visual-text",
  fit: "points-1-key-fig",
  heading: "The word equation",
  lead: "Plants use light energy to make glucose from carbon dioxide and water. Oxygen is also produced.",
  points: [{ kind: "key-point", text: "Carbon dioxide + water → glucose + oxygen" }],
  figure: {
    kind: "flow",
    shows: "The reactants and products of photosynthesis.",
    alt: "Carbon dioxide and water lead to glucose and oxygen.",
    title: null,
    nodes: ["Carbon dioxide + water", "Glucose + oxygen"],
    links: [{ from: 0, to: 1, label: "photosynthesis" }],
  },
};

/** The drawer's two recorded answers (cassette bodies 0006 and 0011), in order. */
const DRAWER = [
  {
    kind: "flow",
    alt: "Photosynthesis uses carbon dioxide and water to make glucose, with oxygen also produced.",
    title: "Photosynthesis word equation",
    layout: "chain",
    steps: [{ label: "Carbon dioxide + water" }, { label: "Glucose + oxygen" }],
    links: [{ from: 0, to: 1, label: "photosynthesis" }],
  },
  {
    kind: "flow",
    title: "Photosynthesis",
    alt: "Carbon dioxide and water are used to make glucose, and oxygen is produced.",
    layout: "chain",
    steps: [
      { label: "Carbon dioxide + water", arrow: "photosynthesis" },
      { label: "Glucose + oxygen" },
    ],
    links: [{ from: 0, to: 1 }],
  },
];

describe("a key-fig flow's planned diagram reaches its slot (TEACH-247 part cn)", () => {
  afterAll(() => endDrawThread());
  test("the writer's flow draws beside the key card: no spec fault, no empty half", async () => {
    // A KS3 studio fixture (as the run was), its writer slide 2 (deck slide 4) swapped for the run's.
    const B = "y8-french-my-family";
    const read = (f: string) =>
      readFileSync(join(import.meta.dir, "fixtures/replay", B, f), "utf8");
    const brief = JSON.parse(read("brief.json")) as Brief;
    const objectives = (
      JSON.parse(read("objectives.json")) as { objectives: { teacher: string }[] }
    ).objectives.map((o) => o.teacher);
    const main = JSON.parse(read("main.json")) as { text: string; finishReason?: string };
    const out = JSON.parse(main.text) as { slides: unknown[] };
    out.slides[1] = structuredClone(SLIDE4);
    let calls = 0;
    const callDrawer: DrawerCall = async (req) => {
      // Only this slide's diagram is answered with the run's recorded drawer specs.
      if (!JSON.stringify(req).includes("photosynthesis")) return { out: undefined };
      return { out: DRAWER[calls++] ?? DRAWER[1] };
    };
    const events: Record<string, unknown>[] = [];
    const lesson = await runWriter({
      brief,
      objectives,
      services: { ...replayServices(B), log: (e) => events.push(e as Record<string, unknown>) },
      visual: recordedVisuals(B),
      recordedWriter: { text: JSON.stringify(out), finishReason: main.finishReason ?? null },
      drawDiagrams: { callDrawer },
      library: true,
      checks: "log",
    });
    // The deck slide that shows the run's slide (found by its heading, not a fixed index).
    const at = lesson.slides.findIndex((x) => JSON.stringify(x.elements).includes(SLIDE4.heading));
    expect(at).toBeGreaterThan(-1);
    const s4 = events.filter((e) => e.slide === at + 1);
    expect(s4.filter((e) => e.ev === "r2-spec-fault")).toEqual([]);
    expect(s4).toContainEqual(
      expect.objectContaining({ ev: "diagram-done", via: "code", ok: true }),
    );
    expect(s4).toContainEqual(expect.objectContaining({ ev: "visual-path", path: "diagram" }));
    expect(s4.filter((e) => e.ev === "unshown-text-only")).toEqual([]);
    // The writer's own spec draws: the drawer is never asked to repair it.
    expect(calls).toBe(0);
    // The flow is on the slide, drawn by code (an SVG image named Diagram).
    const drawn = (lesson.slides[at]?.elements ?? []).filter(
      (e) => (e as { name?: string }).name === "Diagram",
    ) as { src?: string }[];
    expect(drawn).toHaveLength(1);
    expect(decodeURIComponent(drawn[0]?.src ?? "")).toContain("photosynthesis");
  }, 60_000);
});

describe("the width check measures the faces slides are set in (TEACH-247 part cn)", () => {
  test("a flow arrow's subject word that every theme draws passes", () => {
    for (const w of ["photosynthesis", "respiration", "condensation", "Maintenance rehearsal"])
      expect(fitsMeasured(w, LIMITS.flow.link)).toBe(true);
    // Still refused: words that do not fit two lines of the arrow's room.
    expect(
      fitsMeasured("Electrostatic attraction between oppositely charged ions", LIMITS.flow.link),
    ).toBe(false);
  });
  test("every face measured has a metrics table, never the 0.62 em guess; Geist is not one", () => {
    expect(BODY_STACKS.length).toBeGreaterThan(0);
    for (const stack of BODY_STACKS) expect([stack, hasAdvances(stack)]).toEqual([stack, true]);
    expect(hasAdvances(FONT_STACKS.geist)).toBe(false);
    expect(BODY_STACKS).not.toContain(FONT_STACKS.geist);
  });
  test("the drawer reads a key point's words, never 'undefined:'", () => {
    const words = wordsOf(SLIDE4 as never);
    expect(words).toContain("Carbon dioxide + water → glucose + oxygen");
    expect(words).not.toContain("undefined");
  });
});
