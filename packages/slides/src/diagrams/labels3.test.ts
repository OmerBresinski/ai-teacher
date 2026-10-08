// labels3 (BAKEOFF base4f, faults-3-6-8 #3): spare particle labels never fill a literal slot.
// Cases are the lab's real y11 and y7 specs (lab/bakeoff/ab/labels3.test.ts), on by default here.
import { describe, expect, test } from "bun:test";
import { THEMES } from "../themes";
import { drawDiagram } from "./draw";
import { mendParticleLabels, particleLabelFaults } from "./labels3";
import { mendSpec } from "./normalise";
import { DiagramSpecSchema, ParticlesSchema } from "./schema";

const theme = THEMES.find((t) => t.id === "studio") as (typeof THEMES)[number];
const R1_S9 = {
  kind: "particles",
  alt: "Two containers of acid particles at two concentrations.",
  title: "More particles, not faster",
  show: "compare",
  panels: [
    { count: 6, speed: "slow", energy: 1, room: "small" },
    { count: 12, speed: "slow", energy: 1, room: "small" },
  ],
  captions: ["0.5 mol/dm³", "1.0 mol/dm³"],
  notes: ["Same temperature", "Equal volume"],
  arrows: ["short, medium, long", "same mix in both"],
  motion: true,
};
const R3_S8 = {
  kind: "particles",
  alt: "Two containers of acid particles at two concentrations.",
  title: "Concentration and reaction rate",
  show: "compare",
  panels: [
    { count: 6, extra: 1, speed: "slow", room: "small", solid: true },
    { count: 12, extra: 1, speed: "slow", room: "small", solid: true },
  ],
  captions: ["Lower concentration", "Higher concentration"],
  notes: ["Same temperature", "Magnesium surface", "Equal volume"],
  motion: true,
  key: ["Acid particles", "Motion arrows"],
};
const R4_S9 = {
  kind: "particles",
  alt: "Two containers of acid particles at two concentrations.",
  title: "More particles, not faster",
  show: "compare",
  panels: [
    { count: 6, speed: "slow", room: "large", solid: true },
    { count: 12, speed: "slow", room: "large", solid: true },
  ],
  captions: ["0.5 mol/dm³", "1.0 mol/dm³"],
  notes: ["Both at 20°C"],
  motion: true,
  key: ["acid particles", "Mg surface"],
};
const draw = (s: unknown) => {
  let n = 0;
  const d = drawDiagram(s, theme, { x: 0, y: 0, w: 560, h: 420 }, () => `i${n++}`);
  return d.ok ? decodeURIComponent(String(d.element.src)) : undefined;
};

describe("labels3 mend (real cases)", () => {
  test("R1 y11 s9: no between-panel arrow words on a compare, no shared notes", () => {
    const m = mendSpec(R1_S9) as Record<string, unknown>;
    expect(m.arrows).toBeUndefined();
    expect(m.notes).toBeUndefined();
    expect(particleLabelFaults(m)).toEqual([]);
    expect(draw(R1_S9)).not.toContain("short, medium");
  });
  test("R3 y11 s8: no particle swatch labelled 'Motion arrows'; the 3 notes for 2 panels go", () => {
    const m = mendSpec(R3_S8) as Record<string, unknown>;
    expect(m.key).toBeUndefined();
    expect(m.lump).toBeUndefined();
    expect(m.notes).toBeUndefined();
    const svg = draw(R3_S8);
    expect(svg).toBeDefined();
    expect(svg).not.toContain("Motion arrows");
  });
  test("R4 y11 s9: 'Mg surface' names the lump, not a purple particle swatch", () => {
    const m = mendSpec(R4_S9) as Record<string, unknown>;
    expect(m.key).toBeUndefined();
    expect(m.lump).toBe("Mg surface");
    expect(m.notes).toBeUndefined();
    const svg = draw(R4_S9) as string;
    expect(svg).toContain("Mg surface");
    expect(svg.split(theme.colors.accent2).length - 1).toBe(0);
  });
  test("a lump name that does not fit draws the lump unnamed, not nothing", () => {
    const s = {
      ...R3_S8,
      panels: R3_S8.panels.map((p) => ({ ...p, extra: 0 })),
      key: ["acid particle", "magnesium"],
    };
    expect((mendSpec(s) as { lump?: string }).lump).toBe("magnesium");
    expect(draw(s)).toBeDefined();
  });
  test("a true two-kind key stays", () => {
    const s = { ...R3_S8, key: ["Acid particles", "Water molecules"], notes: undefined };
    expect((mendSpec(s) as { key?: string[] }).key).toEqual(["Acid particles", "Water molecules"]);
    const d = { kind: "particles", show: "dissolving", key: ["Water", "Sugar"] };
    expect(mendParticleLabels(d)).toBe(d);
  });
});

describe("labels3: the particles schema refuses spare labels in literal slots", () => {
  test("each real spec is refused with the reason, and its mended form is accepted", () => {
    for (const s of [R1_S9, R3_S8, R4_S9]) {
      expect(ParticlesSchema.safeParse(s).success).toBe(false);
      expect(ParticlesSchema.safeParse(mendSpec(s)).success).toBe(true);
    }
    expect(particleLabelFaults(R1_S9).join(" ")).toContain("leave out `arrows`");
    expect(particleLabelFaults(R3_S8).join(" ")).toContain("never a surface, lump or arrow");
    expect(particleLabelFaults(R4_S9).join(" ")).toContain("one note per panel");
  });
});

describe("labels3 states (D45 y7 s4 and s5)", () => {
  test("s4: drawing notes under Solid, Liquid and Gas are dropped; panels kept", () => {
    const s4 = {
      kind: "particles",
      alt: "x",
      title: "Particle arrangement and movement",
      show: "states",
      panels: [
        { state: "solid", count: 16 },
        { state: "liquid", count: 16 },
        { state: "gas", count: 16 },
      ],
      states: ["solid", "liquid", "gas"],
      captions: ["Solid", "Liquid", "Gas"],
      notes: ["Dots are not real size", "Arrows show movement", "Double arrows show vibration"],
      motion: true,
    };
    const m = mendParticleLabels(s4) as typeof s4;
    expect(m.notes).toBeUndefined();
    expect(m.panels).toHaveLength(3);
  });
  test("s5: the invented gas panel captioned 'Liquid particles stay close' is dropped", () => {
    const s5 = {
      kind: "particles",
      alt: "x",
      title: "Why water flows",
      show: "states",
      panels: [
        { state: "liquid", count: 18 },
        { state: "gas", count: 10 },
      ],
      states: ["liquid", "gas"],
      captions: ["Water particles", "Liquid particles stay close"],
      notes: ["Move past neighbours", "Empty space above water"],
      motion: true,
    };
    const m = mendParticleLabels(s5) as typeof s5;
    expect(m.panels).toBeUndefined();
    expect(m.states).toEqual(["liquid"]);
    expect(DiagramSpecSchema.safeParse(m).success).toBe(true);
    expect(m.captions).toEqual(["Water particles"]);
    expect(m.notes).toEqual(["Move past neighbours"]);
  });
});
