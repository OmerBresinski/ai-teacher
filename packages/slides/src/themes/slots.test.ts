import { describe, expect, test } from "bun:test";
import { THEMES } from "../themes";
import { buildSlots, contrast, type SlotInput } from "./slots";
import { SURFACES } from "./surfaces";

/** The pilot's `theming/slots.json` (round 5) for the themes it lists: the port must match it exactly. */
const PILOT: Record<string, SlotInput & { slots: { fill: string; ink: string }[]; dim: string }> = {
  paper: {
    mode: "light",
    ground: "#FFFAF4",
    surface: "#FFFFFF",
    ink: "#22152B",
    muted: "#5E5066",
    accent: "#D7263D",
    chroma: 1,
    hueShift: [0, 0, 0, 0],
    slots: [
      { fill: "#F4D0D3", ink: "#9C2A44" },
      { fill: "#ADC0D6", ink: "#014580" },
      { fill: "#F8E3BC", ink: "#7A5805" },
      { fill: "#A8CFCD", ink: "#055452" },
    ],
    dim: "#7A6C83",
  },
};

describe("colour slots (ruling 248)", () => {
  test("the port reproduces the pilot's values", () => {
    for (const [id, p] of Object.entries(PILOT)) {
      const { slots, dim } = buildSlots(p);
      expect({ id, slots: slots.map(({ fill, ink }) => ({ fill, ink })), dim }).toEqual({
        id,
        slots: p.slots,
        dim: p.dim,
      });
    }
  });
  test("every picker theme has four slots and a dim tone that read", () => {
    expect(THEMES.length).toBe(16);
    for (const t of THEMES) {
      const s = SURFACES[t.id];
      expect(s?.slots.length).toBe(4);
      for (const slot of s?.slots ?? []) {
        expect(contrast(t.colors.ink, slot.fill)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(slot.ink, slot.fill)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(s?.dim ?? "", t.colors.background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
