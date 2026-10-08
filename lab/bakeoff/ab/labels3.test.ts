// faults-3-6-8 #3: the labels3 particles mend, on the real base4-era specs (diagrams.jsonl).
import { afterEach, describe, expect, test } from "bun:test";
import { drawDiagram } from "../../../packages/slides/src/diagrams/draw";
import {
  mendParticleLabels,
  particleLabelFaults,
  setParticleLabelMend,
} from "../../../packages/slides/src/diagrams/labels3";
import { mendSpec } from "../../../packages/slides/src/diagrams/normalise";
import { ParticlesSchema } from "../../../packages/slides/src/diagrams/schema";
import { THEMES } from "../../../packages/slides/src/themes";
import { AB_CONFIG, abLabels3, setAbArm, setAbCodeArm } from "./arms";
import { labelFaults } from "./labels3replay";

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

afterEach(() => {
  setParticleLabelMend(false);
  setAbCodeArm(undefined);
  setAbArm(undefined);
});

describe("labels3 switch", () => {
  test("off by default: specs pass through unchanged", () => {
    for (const s of [R1_S9, R3_S8, R4_S9]) expect(mendParticleLabels(s)).toBe(s);
  });
  test("only the labels3 arm turns it on", () => {
    setAbArm("base4");
    expect(abLabels3()).toBe(false);
    setAbCodeArm("labels3");
    expect(abLabels3()).toBe(true);
    for (const a of Object.keys(AB_CONFIG))
      if (a !== "labels3" && !["base7", "base7c", "base7d"].includes(a))
        expect(AB_CONFIG[a as keyof typeof AB_CONFIG].labels3).toBeUndefined();
  });
});

describe("labels3 mend (real cases)", () => {
  test("R1 y11 s9: no between-panel arrow words on a compare, no shared notes", () => {
    setParticleLabelMend(true);
    const m = mendSpec(R1_S9) as Record<string, unknown>;
    expect(m.arrows).toBeUndefined();
    expect(m.notes).toBeUndefined();
    expect(labelFaults(m)).toEqual([]);
    expect(draw(R1_S9)).not.toContain("short, medium");
  });
  test("R3 y11 s8: no particle swatch labelled 'Motion arrows'; the 3 notes for 2 panels go", () => {
    setParticleLabelMend(true);
    const m = mendSpec(R3_S8) as Record<string, unknown>;
    expect(m.key).toBeUndefined();
    expect(m.lump).toBeUndefined();
    expect(m.notes).toBeUndefined();
    const svg = draw(R3_S8);
    expect(svg).toBeDefined();
    expect(svg).not.toContain("Motion arrows");
  });
  test("R4 y11 s9: 'Mg surface' names the lump, not a purple particle swatch", () => {
    setParticleLabelMend(true);
    const m = mendSpec(R4_S9) as Record<string, unknown>;
    expect(m.key).toBeUndefined();
    expect(m.lump).toBe("Mg surface");
    expect(m.notes).toBeUndefined();
    const svg = draw(R4_S9) as string;
    expect(svg).toContain("Mg surface");
    expect(svg.split(theme.colors.accent2).length - 1).toBe(0);
  });
  test("a lump name that does not fit draws the lump unnamed, not nothing", () => {
    setParticleLabelMend(true);
    const s = {
      ...R3_S8,
      panels: R3_S8.panels.map((p) => ({ ...p, extra: 0 })),
      key: ["acid particle", "magnesium"],
    };
    expect((mendSpec(s) as { lump?: string }).lump).toBe("magnesium");
    expect(draw(s)).toBeDefined();
  });
  test("a true two-kind key stays", () => {
    setParticleLabelMend(true);
    const s = { ...R3_S8, key: ["Acid particles", "Water molecules"], notes: undefined };
    expect((mendSpec(s) as { key?: string[] }).key).toEqual(["Acid particles", "Water molecules"]);
    const d = { kind: "particles", show: "dissolving", key: ["Water", "Sugar"] };
    expect(mendParticleLabels(d)).toBe(d);
  });
});

describe("labels3 step 4: the schema refuses spare labels in literal slots", () => {
  test("off: ParticlesSchema accepts the real specs as before", () => {
    for (const s of [R1_S9, R3_S8, R4_S9]) expect(ParticlesSchema.safeParse(s).success).toBe(true);
    expect(particleLabelFaults(R4_S9)).toEqual([]);
  });
  test("on: each real spec is refused with the reason, and its mended form is accepted", () => {
    setParticleLabelMend(true);
    for (const s of [R1_S9, R3_S8, R4_S9]) {
      const r = ParticlesSchema.safeParse(s);
      expect(r.success).toBe(false);
      expect(ParticlesSchema.safeParse(mendSpec(s)).success).toBe(true);
    }
    expect(particleLabelFaults(R1_S9).join(" ")).toContain("leave out `arrows`");
    expect(particleLabelFaults(R3_S8).join(" ")).toContain("never a surface, lump or arrow");
    expect(particleLabelFaults(R4_S9).join(" ")).toContain("one note per panel");
  });
});
