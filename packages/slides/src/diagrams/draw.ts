/**
 * dd-diagrams: the one call a layout makes to put a diagram in a zone, and the one answer it can
 * act on. A drawing that is not readable is a failure, never a faint or broken picture: the caller
 * drops the panel (and its wash) and lets the words stand alone, as it does for a picture that
 * could not be found.
 *
 * Readable means, on the theme asked for: no label cut, off the drawing, touching the drawing's
 * edge, overlapping another label or set across a line; every label at or over the 18 pt floor as
 * shown on the slide; arrows ending at their boxes; value axes reaching their data; a plot that is
 * neither squashed nor stretched into a strip (`ASPECT_MAX`); a flow within its key stage's step
 * cap; particle panels that fit. Whatever the renderers flag as a fault counts too.
 */
import type { ImageElement, Theme } from "@tj/domain/documents";
import { uid } from "../factories";
import { diagramGeometryFaults } from "./geometry";
import { diagramElement, mendSpec, parseDiagram, simplerDiagrams, withLongLabels } from "./index";
import { context } from "./svg";

export type DrawnDiagram =
  | {
      ok: true;
      element: ImageElement;
      /** The label size it drew at (slide points, before any zoom into the zone). */
      fs: number;
      /** Which simpler form drew (0 = the spec as normalised). */
      rung: number;
      /** The spec actually drawn (store it with the slide if you keep specs). */
      spec: unknown;
    }
  | { ok: false; reasons: string[] };

/** Every readability fault of `spec` drawn in `size` on `theme`; empty when it reads cleanly. */
export function readabilityFaults(
  spec: unknown,
  theme: Theme,
  size: { w: number; h: number; fs?: number },
): string[] {
  // r3-diag: read as drawDiagram draws it (labels a little over their limit stretched).
  return withLongLabels(() => {
    if (!parseDiagram(spec)) return ["it does not draw"];
    try {
      return diagramGeometryFaults(spec, theme, size as { w: number; h: number });
    } catch {
      return ["it does not draw"];
    }
  });
}

/**
 * The diagram for `spec` in `rect`, or why it cannot be drawn readably there. Tries the spec as
 * normalised and then each simpler form, each from the zone's label size (or `rect.fs`) down to
 * the key stage's small-text floor, and takes the first that reads cleanly. Never throws.
 */
export function drawDiagram(
  spec: unknown,
  theme: Theme,
  rect: { x: number; y: number; w: number; h: number; fs?: number },
  ids: () => string = uid,
): DrawnDiagram {
  // Round 6: optional decoration that cannot stand (a timeline period given as years) is mended.
  spec = mendSpec(spec);
  try {
    return withLongLabels(() => {
      if (!parseDiagram(spec)) return { ok: false, reasons: ["the spec does not parse"] };
      const base = context(theme, Math.round(rect.w), Math.round(rect.h), rect.fs);
      const floor = base.minFs;
      let last: string[] = [];
      // Last rungs: each form without its own title (the slide's heading already names it).
      const forms = simplerDiagrams(spec);
      for (const f of [...forms]) {
        const o = f as { title?: string };
        if (o && typeof o === "object" && o.title) {
          const { title: _t, ...bare } = o;
          forms.push(bare);
        }
      }
      for (const [rung, form] of forms.entries()) {
        if (!parseDiagram(form)) continue;
        for (let fs = base.fs; fs >= floor; fs -= 1) {
          const size = { w: rect.w, h: rect.h, fs };
          const faults = readabilityFaults(form, theme, size);
          if (faults.length) {
            if (fs === base.fs || last.length === 0) last = faults;
            continue;
          }
          const element = diagramElement(form, theme, { ...rect, fs }, ids);
          if (element) return { ok: true, element, fs, rung, spec: form };
        }
      }
      return { ok: false, reasons: last.length ? last : ["it does not draw"] };
    });
  } catch {
    return { ok: false, reasons: ["it does not draw"] };
  }
}
