import { describe, expect, test } from "bun:test";
import { getTheme, THEMES } from "../themes";
import {
  buildCount,
  builtSvgDataUrl,
  hasAnswerPart,
  part,
  stripBuilds,
  svgAtBuild,
  svgOfDataUrl,
  withBuilds,
} from "./builds";
import { renderDiagram } from "./index";
import { fromMeaning } from "./meaning";
import { MEANING_SAMPLES } from "./meaning-samples";
import { DIAGRAM_SAMPLES } from "./samples";

const size = { w: 788, h: 235 };
const side = { w: 348, h: 284 };
const all = [
  ...Object.values(DIAGRAM_SAMPLES),
  ...Object.values(MEANING_SAMPLES).map((s) => fromMeaning(s)),
];

describe("diagram builds (TEACH-247 part b)", () => {
  test("off, nothing is tagged; on, the tags strip back to the plain render byte for byte", () => {
    let tagged = 0;
    for (const theme of THEMES)
      for (const spec of all)
        for (const sz of [size, side]) {
          const plain = renderDiagram(spec, theme, sz);
          const built = withBuilds(() => renderDiagram(spec, theme, sz));
          expect(built === undefined).toBe(plain === undefined);
          if (!plain || !built) continue;
          expect(plain).not.toContain("data-s=");
          expect(stripBuilds(built)).toBe(plain);
          if (buildCount(built) > 0) tagged += 1;
        }
    expect(tagged).toBeGreaterThan(0);
  });
  test("a chain flow builds one box (with the arrow into it) per step", () => {
    const flow = Object.values(DIAGRAM_SAMPLES).find(
      (s) =>
        (s as { kind: string }).kind === "flow" && (s as { layout?: string }).layout === "chain",
    ) as { steps: unknown[] } | undefined;
    if (!flow) return;
    const svg = withBuilds(() => renderDiagram(flow, getTheme("studio"), size));
    expect(buildCount(svg ?? "")).toBe(flow.steps.length - 1);
  });
  test("a bar model's combined total is the last build and an answer part", () => {
    const bm = Object.values(MEANING_SAMPLES).find(
      (s) =>
        (s as { kind: string; combined?: boolean }).kind === "bar-model" &&
        (s as { combined?: boolean }).combined,
    );
    const svg = withBuilds(() => renderDiagram(fromMeaning(bm), getTheme("studio"), size)) ?? "";
    expect(hasAnswerPart(svg)).toBe(true);
  });
  test("svgAtBuild hides later builds and the answer, animates only the newest build", () => {
    const svg = withBuilds(
      () =>
        `<svg viewBox="0 0 1 1">${part(0, "<rect/>")}${part(1, "<circle/>")}${part(2, "<path/>")}</svg>`,
    );
    expect(buildCount(svg)).toBe(2);
    const at1 = svgAtBuild(svg, 1, { answer: true, motion: true });
    expect(at1).toContain('[data-s="2"]{opacity:0}');
    expect(at1).toContain('[data-s="1"]{animation');
    const still = svgAtBuild(svg, 1, { answer: true, motion: false });
    expect(still).not.toContain("animation");
    expect(svgAtBuild(svg, 2, { answer: true, motion: false })).toBe(svg);
    expect(svgOfDataUrl(builtSvgDataUrl(svg))).toBe(svg);
    expect(svgOfDataUrl("https://x/y.png")).toBeUndefined();
    expect(part(1, "<rect/>")).toBe("<rect/>");
  });
});
