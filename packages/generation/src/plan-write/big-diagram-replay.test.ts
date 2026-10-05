import { describe, expect, test } from "bun:test";
import { getTheme, materialiseSlide, PLACEHOLDER_IMAGE, slideFits, THEMES } from "@tj/slides";
import { renderWritten } from "./fit";
import fixtures from "./fixtures/layout-fix-big-diagrams.json";
import { adapt, expandDrawing, placeT3Diagram, t3DiagramBase, withPictureZone } from "./simple";

/**
 * LAYOUT-FIX smoke: the writer chose big-diagram for y7 (particles, three states), y9 (a 6-step
 * flow) and y1 (a 3-step flow), and both were dropped. Replayed offline, the specs are valid; their three lines measured 6
 * and 5 lines under the drawing, past the 4-line cap, so the step-up was refused and the drawing
 * fell back to the half zone, where it does not fit. Whole lines past the cap now go to the notes.
 */
describe("LAYOUT-FIX big diagrams replayed from the smoke", () => {
  const meta = { promptVersion: "t", model: "code", at: "1970-01-01T00:00:00.000Z" };
  let n = 0;
  for (const f of fixtures as {
    source: string;
    heading: string;
    content: string[];
    notes: string;
    picture: Record<string, unknown>;
  }[])
    for (const theme of THEMES.map((t) => getTheme(t.id)))
      test(`${f.source} on ${theme.id}: drawn (full width unless sparse), every line on the slide or in the notes`, () => {
        const light = withPictureZone({
          form: "big-diagram",
          heading: f.heading,
          body: f.content,
          items: [],
          questions: [],
          picture: { kind: "diagram", spec: f.picture },
          notes: f.notes,
        } as never);
        const a = adapt(light as never);
        const r = renderWritten(a.form, a.layout, a.out);
        const slide = materialiseSlide(
          r.spec,
          theme.id,
          meta,
          () => `f${n++}`,
          r.variant,
          r.structure,
        );
        const spec = expandDrawing(f.picture);
        const base = t3DiagramBase(slide, spec, theme, true);
        const zone = base.elements.find((e) => e.type === "image" && e.src === PLACEHOLDER_IMAGE);
        // lab/cand: y1's 3-box flow is sparse across the slide (a strip in empty space), so it
        // steps down to the half zone with its words beside it; the others keep the full width.
        if (f.heading === "A chick grows") expect(zone?.w ?? 844).toBeLessThan(844);
        else expect(zone?.w).toBe(844);
        const d = placeT3Diagram(base, spec, theme, () => `g${n++}`);
        expect(d.reasons).toEqual([]);
        expect(d.slide).toBeDefined();
        // No overflow or overlap as the fit check measures it (paragraph gaps, a two-line heading).
        expect(slideFits(d.slide as never, theme, 0).ok).toBe(true);
        const shown = JSON.stringify(base.elements) + (base.notes ?? "");
        // The photo form sets each sentence as its own line, so look for each sentence.
        for (const line of f.content)
          for (const sentence of line.split(/(?<=[.!?])\s+/))
            expect(shown).toContain(JSON.stringify(sentence).slice(1, -1));
      });
});
