import { describe, expect, test } from "bun:test";
import { atKeyStage, getTheme, keyStageOf, typeScale } from "../themes";
import { drawDiagram } from "./index";
import { DIAGRAM_SAMPLES } from "./samples";

const RECT = { x: 0, y: 0, w: 403, h: 340 };
const SPEC = Object.values(DIAGRAM_SAMPLES)[0];
/** Ids from a counter, so two drawings of the same thing are byte-identical. */
const counter = () => {
  let i = 0;
  return () => `d${i++}`;
};
const draw = (t: ReturnType<typeof getTheme>) => {
  const r = drawDiagram(SPEC, t, RECT, counter());
  return r.ok ? `${r.fs} ${r.element.src}` : `refused ${r.reasons.join("; ")}`;
};
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("the key stage travels with the theme", () => {
  test("a catalogue theme has no stage; a staged copy does, and the catalogue is untouched", () => {
    const base = getTheme("studio");
    const ks1 = atKeyStage(base, "ks1");
    expect(keyStageOf(base)).toBeUndefined();
    expect(typeScale(base)).toBeUndefined();
    expect(keyStageOf(ks1)).toBe("ks1");
    expect(typeScale(ks1)?.body).toBe(33);
    expect(atKeyStage(base, "year 9")).toBe(base);
    expect(getTheme("studio")).toBe(base);
  });

  test("jobs at different stages, interleaved across awaits, each draw at their own stage", async () => {
    const base = getTheme("studio");
    const alone = { ks1: draw(atKeyStage(base, "ks1")), ks5: draw(atKeyStage(base, "ks5")) };
    const none = draw(base);
    expect(alone.ks1).not.toBe(alone.ks5);
    const job = async (band?: "ks1" | "ks5") => {
      const t = atKeyStage(base, band);
      const out: string[] = [];
      for (let i = 0; i < 4; i++) {
        await tick();
        out.push(draw(t));
      }
      return out;
    };
    // A job with no stage runs beside them and still draws the theme's own sizes.
    const [a, b, c] = await Promise.all([job("ks1"), job("ks5"), job()]);
    expect(a).toEqual(Array(4).fill(alone.ks1));
    expect(b).toEqual(Array(4).fill(alone.ks5));
    expect(c).toEqual(Array(4).fill(none));
  });
});
