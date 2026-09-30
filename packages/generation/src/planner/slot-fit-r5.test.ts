import { describe, expect, test } from "bun:test";
import { fitsPlanned } from "@tj/slides";
import flagged from "../fixtures/designer-r5-flagged.json";
import type { DesignSlot } from "../prompts/design-cycle";
import { fitSlot } from "./slot-fit";

/*
 * Designer round 5, arm F (the facts feed): the two slots that were flagged and overflowed on all
 * 10 themes after Tidy. Both are worked examples whose working card is a fixed box, so moving the
 * last step out never shrank it, and the sequence sibling was only ever tried with every step.
 */
const slots = flagged as Record<string, DesignSlot>;

const words = (s: DesignSlot): string[] =>
  JSON.stringify(s)
    .replace(/"[a-zA-Z]+":/g, " ")
    .toLowerCase()
    .match(/[a-z0-9’']+/g)
    ?.filter((w) => !["form", "worked", "example", "sequence", "true", "false"].includes(w)) ?? [];

describe("r5 arm F: a worked example whose working card cannot hold its steps", () => {
  for (const [key, slot] of Object.entries(slots)) {
    test(`${key} lands a fitting slot, every word kept`, async () => {
      const refill = async () => undefined;
      const fit = await fitSlot(slot, { seed: key, themeId: "chalk", refill });
      expect(fit.rung).not.toBe("flagged");
      const gate = fitsPlanned(fit.render.spec, {
        stepDown: 1,
        ...(fit.render.variant ? { variant: fit.render.variant } : {}),
        structure: fit.render.structure,
      });
      expect(gate.ok).toBe(true);
      // Whole units to the notes, word for word: nothing shortened, nothing dropped.
      const landed = new Set(words(fit.slot));
      expect(words(slot).filter((w) => !landed.has(w))).toEqual([]);
      if (fit.slot.form === "sequence") expect(fit.slot.steps.length).toBeGreaterThanOrEqual(2);
    });
  }
});
