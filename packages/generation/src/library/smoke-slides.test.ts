import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { layoutTemplate } from "@tj/slides/templates";
import { atKeyStage, THEMES } from "@tj/slides/themes";
import { inspectDrawnSvg } from "./render";

/*
 * TEACH-247 part h: the library drawings from the real smoke lessons (y3 science, y11 chemistry,
 * 9 Oct; the embedded font stripped to keep the fixture small), laid out by the real slide renderer
 * the way the writer now places them: big-diagram, heading and the bare drawing only. Every word sits
 * in the view box, and none is under the ratchet once the slide is shown 1440 px wide.
 */
type Shot = { lesson: string; slide: number; svg: string };
const SHOTS = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures/smoke-library-slides.json"), "utf8"),
) as Shot[];
/**
 * Measured on these drawings once the model fills the band bare (9 Oct): 17.9 px at the smallest
 * (y11's three-panel collision_theory). A ratchet, not the kit's 27 px floor at 1440 (24 units on
 * its 1280-wide slide), which no layout under a heading reaches; that is a layout ruling.
 */
const FLOOR_PX = 17.5;

for (const s of SHOTS)
  test(`${s.lesson} slide ${s.slide}: inside its slot, no word under ${FLOOR_PX} px`, () => {
    const { viewBox, words } = inspectDrawnSvg(s.svg);
    const [vx, vy, vw, vh] = viewBox;
    const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.svg)}`;
    const stage = s.lesson.startsWith("y11") ? "ks4" : "ks2";
    const theme = atKeyStage(THEMES[0] as never, stage);
    const els = layoutTemplate(
      {
        template: "big-diagram",
        heading: "Heading",
        figure: { drawn: { src, aspect: vw / vh, bare: true } },
      } as never,
      theme,
      stage,
    ).slide.elements as { name?: string; w: number; h: number }[];
    const img = els.find((e) => e.name === "Diagram");
    expect(img).toBeDefined();
    const k = Math.min((img?.w ?? 0) / vw, (img?.h ?? 0) / vh) * (1440 / 960);
    expect(words.length).toBeGreaterThan(0);
    for (const w of words) {
      expect(w.fs * k, w.words).toBeGreaterThanOrEqual(FLOOR_PX);
      expect(
        w.x0 >= vx - 1 && w.x1 <= vx + vw + 1 && w.y0 >= vy - 1 && w.y1 <= vy + vh + 1,
        w.words,
      ).toBe(true);
    }
  });
