import { describe, expect, test } from "bun:test";
import { getTheme, THEMES } from "../themes";
import { buildSlots, contrast, type SlotInput, slotsAt } from "./slots";
import { SURFACES } from "./surfaces";
import TOKENS from "./tokens.json";

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
  // TEACH-215 part c: the other themes the pilot's slots.json lists (16 Oct 2026).
  poster: {
    ...{
      mode: "light",
      ground: "#FFF4E2",
      surface: "#FFFFFF",
      ink: "#1B1B2F",
      muted: "#3B3C52",
      accent: "#B8360F",
      chroma: 1.35,
      hueShift: [8, 0, 0, -6],
    },
    slots: [
      { fill: "#FCCCCB", ink: "#A8112D" },
      { fill: "#A6C0DD", ink: "#014580" },
      { fill: "#FDE0AC", ink: "#7A5805" },
      { fill: "#9DD1CA", ink: "#065650" },
    ],
    dim: "#6B6C84",
  },
  storytime: {
    ...{
      mode: "light",
      ground: "#FFFCF5",
      surface: "#FFFFFF",
      ink: "#1E2A3A",
      muted: "#46536A",
      accent: "#1F5FBF",
      chroma: 1.15,
      hueShift: [0, 0, 0, 0],
    },
    slots: [
      { fill: "#F8CFD3", ink: "#A41940" },
      { fill: "#ABC1DA", ink: "#014580" },
      { fill: "#FBE2B6", ink: "#7A5805" },
      { fill: "#A4D0CE", ink: "#005553" },
    ],
    dim: "#64728A",
  },
  "dark-slate": {
    ...{
      mode: "dark",
      ground: "#1E232B",
      surface: "#262C35",
      ink: "#E4E7EB",
      muted: "#A9B1BC",
      accent: "#9DBBD0",
      chroma: 0.8,
      hueShift: [0, 0, 0, 0],
    },
    slots: [
      { fill: "#5F4547", ink: "#FFAEB7" },
      { fill: "#2A3C51", ink: "#8FB6E3" },
      { fill: "#615643", ink: "#F9DBA6" },
      { fill: "#2E4847", ink: "#91C8C6" },
    ],
    dim: "#8E96A1",
  },
  "dark-ember": {
    ...{
      mode: "dark",
      ground: "#1B1B1E",
      surface: "#252528",
      ink: "#EDEDEF",
      muted: "#ABABB2",
      accent: "#F2A08C",
      chroma: 1,
      hueShift: [0, 0, 0, 0],
    },
    slots: [
      { fill: "#614145", ink: "#FEABB5" },
      { fill: "#243B55", ink: "#85B7EE" },
      { fill: "#62543C", ink: "#FFDA97" },
      { fill: "#264947", ink: "#84CBC8" },
    ],
    dim: "#909096",
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
  test("Calm's 7:1 port: slot inks and dim reproduce tokens.json, and read 7:1", () => {
    const calm = getTheme("calm");
    const input: SlotInput = {
      mode: "light",
      ground: "#F6F6F2",
      surface: "#FFFFFF",
      ink: "#1E2226",
      muted: "#383E45",
      accent: "#245150",
      chroma: 0.8,
      hueShift: [0, 0, 0, 0],
    };
    const { slots, dim } = slotsAt(buildSlots(input), input, 7);
    expect({ slots: slots.map(({ fill, ink }) => ({ fill, ink })), dim }).toEqual({
      slots: [1, 2, 3, 4].map((n) => ({
        fill: (TOKENS as Record<string, Record<string, string>>).calm?.[`cat-${n}-fill`],
        ink: (TOKENS as Record<string, Record<string, string>>).calm?.[`cat-${n}-ink`],
      })),
      dim: (TOKENS as Record<string, Record<string, string>>).calm?.dim,
    });
    for (const s of slots)
      for (const g of [calm.colors.background, calm.colors.surface, s.fill])
        expect(contrast(s.ink, g)).toBeGreaterThanOrEqual(7);
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
