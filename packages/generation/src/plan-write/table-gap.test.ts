import { describe, expect, test } from "bun:test";
import { getTheme, materialiseSlide, slideFits, THEMES } from "@tj/slides";
import { renderWritten } from "./fit";
import {
  adapt,
  fromTeacher3,
  placeT3Diagram,
  t3DiagramBase,
  t3DiagramSpec,
  t3Fit,
  withPictureZone,
} from "./simple";

/*
 * CANDIDATE fault 9c (y7 s4): the table stepped up to the full width was drawn at the top of a
 * zone much taller than it, so a tall empty band sat between the table and the lines under it.
 * The zone closes up to the table and the lines follow at the normal gap.
 */
describe("a table over its lines leaves no empty band (y7 s4)", () => {
  const meta = { promptVersion: "t", model: "code", at: "1970-01-01T00:00:00.000Z" };
  const picture = {
    kind: "table",
    title: "Properties of each state",
    header: ["State", "Shape", "Volume", "Compressibility"],
    rows: [
      ["Solid", "Fixed", "Fixed", "Hard to compress"],
      ["Liquid", "Container’s shape", "Fixed", "Hard to compress"],
      ["Gas", "Fills container", "Not fixed", "Easy to compress"],
    ],
  };
  const content = [
    "Fixed positions give a solid a fixed shape. Liquid particles move past each other, so liquids take the container’s shape.",
    "Gas particles spread out to fill the container: gases have no fixed shape or volume.",
    "Solids and liquids have fixed volumes and are hard to compress. Gases compress because particles have large gaps between them.",
  ];
  let n = 0;
  for (const theme of THEMES.map((t) => getTheme(t.id)))
    test(`${theme.id}: the lines follow the table at the normal gap`, () => {
      const [light] = fromTeacher3([], {
        titlePicture: null,
        slides: [
          {
            objectives: [],
            form: "picture",
            heading: "4. Particles explain the properties",
            content,
            questions: [],
            picture,
            notes: "",
          },
        ],
      } as never).slides;
      const ps = withPictureZone(light as never);
      const a = adapt(ps);
      const f = t3Fit(a.form, a.layout, a.out, ps.questions);
      const r = renderWritten(f.form, f.layout, f.out);
      const slide = materialiseSlide(
        r.spec,
        theme.id,
        meta,
        () => `t${n++}`,
        r.variant,
        r.structure,
      );
      const spec = t3DiagramSpec((ps.picture as { spec: unknown }).spec, ps as never);
      const d = placeT3Diagram(
        t3DiagramBase(slide, spec, theme, false),
        spec,
        theme,
        () => `u${n++}`,
      );
      expect(d.reasons).toEqual([]);
      expect(d.slide).toBeDefined();
      const els = d.slide?.elements ?? [];
      const fig = els.find((e) => e.type === "image");
      expect(fig).toBeDefined();
      if (!fig) return;
      expect(slideFits(d.slide as never, theme, 0).ok).toBe(true);
      const under = els.filter((e) => e.type === "text" && e.y >= fig.y + fig.h - 1);
      if (under.length === 0) return; // the table stayed beside its words on this theme
      const top = Math.min(...under.map((e) => e.y));
      expect(top - (fig.y + fig.h)).toBeLessThanOrEqual(24);
    });
});
