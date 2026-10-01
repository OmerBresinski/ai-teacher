import { describe, expect, test } from "bun:test";
import { THEMES } from "../themes";
import { diagramFaults, parseDiagram, renderDiagram } from "./index";
import { TEMPLATE_SPECS } from "./template-specs";

/*
 * Round I: every template (and the bar model and number line it keeps) draws on all 10 themes at
 * three slot sizes with no label collision, nothing run off or cut, and no fault of its own.
 */
const SIZES = [
  { w: 403, h: 336 },
  { w: 403, h: 378 },
  { w: 490, h: 245 },
];

describe("I1 templates", () => {
  for (const [name, spec] of Object.entries(TEMPLATE_SPECS)) {
    test(`${name} parses and draws cleanly on every theme and slot`, () => {
      expect(parseDiagram(spec)).toBeDefined();
      const faults = SIZES.flatMap((size) =>
        THEMES.flatMap((t) => {
          const svg = renderDiagram(spec, t, size);
          const out = svg ? [] : ["it does not draw"];
          return [...out, ...diagramFaults(spec, t, size)].map(
            (f) => `${t.id} ${size.w}x${size.h}: ${f}`,
          );
        }),
      );
      expect(faults).toEqual([]);
    });
  }

  test("a particles spec with a state twice does not parse", () => {
    expect(parseDiagram({ kind: "particles", alt: "a", states: ["gas", "gas"] })).toBeUndefined();
  });
  test("a cycle with a step twice does not parse", () => {
    expect(
      parseDiagram({ kind: "cycle", alt: "a", steps: ["Solid", "Liquid", "liquid"] }),
    ).toBeUndefined();
  });
  test("a river label for a part the view lacks does not parse", () => {
    expect(
      parseDiagram({
        kind: "river",
        alt: "a",
        view: "v-valley",
        labels: [{ part: "river-cliff", text: "Cliff" }],
      }),
    ).toBeUndefined();
  });
});
