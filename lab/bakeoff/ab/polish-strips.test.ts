// polish arm: a writer's strips figure goes through to a drawn SVG; the count matches the shading.
import { afterEach, describe, expect, test } from "bun:test";
import { renderDiagram } from "../../../packages/slides/src/diagrams/index";
import {
  setDiagramPolish,
  stripColours,
  withDiagramPolish,
} from "../../../packages/slides/src/diagrams/polish";
import { context } from "../../../packages/slides/src/diagrams/svg";
import { layoutTemplate } from "../../../packages/slides/src/templates/index";
import { getTheme, withKeyStage } from "../../../packages/slides/src/themes";
import { diagramSpec, Ledger } from "../services";
import { setAbArm } from "./arms";
import { labelsOf, writerSpecOf } from "./r2";

const theme = getTheme("splash", "ks1" as never);
const day = stripColours(context(theme, 560, 420).c, false, "splash").day;
const svgOf = (src: string) => decodeURIComponent(src.slice(src.indexOf(",") + 1));
const dayRects = (svg: string) =>
  (svg.match(new RegExp(`<rect[^>]*fill="${day}"`, "g")) ?? []).length;

afterEach(() => {
  setAbArm(undefined);
  setDiagramPolish(false);
});

// The writer's figure as the polish schema has it (dg-strips-side): nulls where nothing is set.
const figure = {
  kind: "strips",
  shows: "Two 12-unit day strips: summer has more daylight than winter",
  alt: "Summer has 16 hours of daylight and winter 8.",
  title: null,
  units: 12,
  unit: "hours",
  key: { light: "daylight", dark: "dark" },
  rows: [
    { label: "summer", light: 8, start: null },
    { label: "winter", light: 4, start: null },
  ],
};

describe("writer strips figure to drawn SVG", () => {
  test("polish: writerSpecOf keeps it, diagramSpec accepts it, the slide draws it", async () => {
    setAbArm("polish");
    setDiagramPolish(true);
    const spec = writerSpecOf(figure);
    expect(spec?.kind).toBe("strips");
    const events: { ev?: string }[] = [];
    const out = await diagramSpec(
      {
        key: "9:diagram",
        kind: "strips",
        shows: figure.shows,
        labels: labelsOf(spec),
        words: "",
        yearGroup: "Year 1",
        spec,
        slot: { placement: "beside text", w: 560, h: 420, name: "side" },
        stage: "ks1",
        theme: "splash",
      },
      new Ledger(0),
      (e) => events.push(e as { ev?: string }),
    );
    expect(events).toEqual([{ ev: "r2-spec-drawn", key: "9:diagram", kind: "strips" }]);
    expect(out).toBeDefined();
    const r = withKeyStage("ks1" as never, () =>
      layoutTemplate(
        {
          template: "diagram-text",
          heading: "Day length",
          lead: "Which strip has more daylight?",
          figure: { diagram: out },
        } as never,
        theme,
        "ks1" as never,
      ),
    ) as { slide: { elements: { type: string; src?: string }[] }; diagram?: string[] };
    expect(r.diagram).toBeUndefined();
    const img = r.slide.elements.find(
      (e) => e.type === "image" && e.src?.startsWith("data:image/svg"),
    );
    const svg = svgOf(img?.src as string);
    expect(svg).toContain("summer");
    expect(svg).toContain("16 hours");
    expect(svg).toContain("8 hours");
    expect(dayRects(svg)).toBe(8 + 4 + 1); // two rows' daylight units and the key's swatch
  });
  test("base4: the same figure is not a writer spec (no strips outside polish)", () => {
    setAbArm("base4");
    expect(writerSpecOf(figure)).toBeUndefined();
  });
});

describe("the count matches the shaded units for any N", () => {
  const draw = (spec: object) =>
    withDiagramPolish(true, () =>
      withKeyStage("ks1" as never, () => renderDiagram(spec, theme, { w: 1100, h: 480 })),
    ) as string;
  test("hours: a row is a day, so each of N units counts 24/N hours (N = 2..24)", () => {
    for (let n = 2; n <= 24; n++)
      for (const light of [0, 1, Math.floor(n / 2), n]) {
        const svg = draw({
          kind: "strips",
          alt: "strips",
          units: n,
          unit: "hours",
          rows: [
            { label: "A", light },
            { label: "B", light: n - light },
          ],
        });
        expect(svg).toBeDefined();
        expect(dayRects(svg)).toBe(n + 1);
        const hours = (k: number) => `>${Math.round(((k * 24) / n) * 10) / 10} hours<`;
        expect(svg).toContain(hours(light));
        expect(svg).toContain(hours(n - light));
      }
  });
  test("other units count one each; `whole` sets the row's total", () => {
    const rows = [
      { label: "A", light: 3 },
      { label: "B", light: 5 },
    ];
    const days = draw({ kind: "strips", alt: "w", units: 7, unit: "days", rows });
    expect(days).toContain(">3 days<");
    expect(days).toContain(">5 days<");
    const mins = draw({ kind: "strips", alt: "m", units: 6, unit: "minutes", whole: 60, rows });
    expect(mins).toContain(">30 minutes<");
    expect(mins).toContain(">50 minutes<");
  });
});
