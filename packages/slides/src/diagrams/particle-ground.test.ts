import { describe, expect, test } from "bun:test";
import { THEMES } from "../themes";
import { renderDiagram } from "./index";
import { DIAGRAM_SAMPLES } from "./samples";

/*
 * Rulings 160 and 162: a diagram sits on the theme's ground. The particle states drew a grey
 * filled panel behind each state (y7 s3); a container is a simple outline (a beaker: open at the
 * top), never a filled panel.
 */
const blocks = (svg: string) =>
  [...svg.matchAll(/<(rect|path)\b([^>]*)>/g)].filter((m) => {
    const fill = /\sfill="([^"]*)"/.exec(m[2] ?? "")?.[1];
    return !!fill && fill !== "none" && fill !== "transparent";
  });

describe("particle containers are outlines on the ground (rulings 160, 162)", () => {
  for (const name of ["particles", "labelled-particles", "labelled-particles-states"] as const)
    for (const theme of THEMES)
      test(`${name} on ${theme.id}: no filled panel, an open outline per state`, () => {
        const svg = renderDiagram(DIAGRAM_SAMPLES[name], theme, { w: 844, h: 300 }) as string;
        expect(svg.length).toBeGreaterThan(0);
        expect(blocks(svg)).toHaveLength(0);
        const outlines = [...svg.matchAll(/<path\b([^>]*)>/g)].filter((m) =>
          /\sstroke="(?!none)[^"]+"/.test(m[1] ?? ""),
        );
        expect(outlines.length).toBeGreaterThanOrEqual(2);
      });
});
