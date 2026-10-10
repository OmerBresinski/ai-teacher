import { describe, expect, test } from "bun:test";
import type { TextPreset } from "@tj/domain/documents";
import { stepDownSize } from "./reflow";
import { resolveFontSize } from "./text-style";
import { atKeyStage, THEMES } from "./themes";

/*
 * prod-15: after a theme switch the reflow stepped a lead and its points from 25 to 20 and sized
 * their boxes for 20, but a theme read at a key stage draws text only on its stage's steps, so the
 * renderer drew them at 25 again and the lead ran into the points (d52 T5 y6 heart lesson, Chalk,
 * slide 3). A step down must land on a size the renderer draws, or not step at all.
 */

const STAGES = [undefined, "ks1", "ks2", "ks3", "ks4", "ks5"] as const;
const PRESETS: TextPreset[] = ["heading", "body", "small"];

describe("a step down lands on a size the renderer draws", () => {
  for (const base of THEMES) {
    for (const stage of STAGES) {
      const theme = atKeyStage(base, stage);
      test(`${base.id} at ${stage ?? "no stage"}`, () => {
        for (const preset of PRESETS) {
          let size = resolveFontSize(theme, preset);
          for (let i = 0; i < 6; i++) {
            const next = stepDownSize(theme, preset, size);
            expect(resolveFontSize(theme, preset, next)).toBe(next);
            expect(next).toBeLessThanOrEqual(size);
            if (next === size) break;
            size = next;
          }
        }
      });
    }
  }
});
