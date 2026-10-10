/**
 * Diagrams from a JSON spec (quality PRD: replace "Diagram to add" with a drawing). The writer
 * fills a `DiagramSpec`; `renderDiagram` draws it as a self-contained SVG in the theme's colours
 * and families, sized in slide points; `diagramElement` wraps that as an image element for a slot.
 *
 * Never throws and never draws an error: a spec that does not parse, or a renderer that fails,
 * gives `undefined`, and the caller draws nothing.
 */
import type { DiagramSource, ImageElement, Theme } from "@tj/domain/documents";
import { uid } from "../factories";
import { THEMES } from "../themes";
import { drawBarModel } from "./bar-model";
import { drawBarChart, drawCarroll, drawPie, drawVenn } from "./charts";
import { drawCubes } from "./cubes";
import { drawFlow } from "./flow";
import { drawEqualGroups, drawFractionShapes } from "./groups";
import { drawLabelled } from "./labelled";
import { mendParticleLabels } from "./labels3";
import { drawLineGraph } from "./line-graph";
import { fromMeaning } from "./meaning";
import { simplerDiagrams } from "./normalise";
import { drawNumberLine } from "./number-line";
import { clipParticleLists, mendParticles } from "./particles-mend";
import { type DiagramSpec, DiagramSpecSchema } from "./schema";
import { LONG_LABEL_STRETCH, parseStretched } from "./stretch";
import { finished, laddered, look, WEIGHT } from "./style";
import { type Ctx, context, type DrawnText, esc, mix, n, text, titleCtx, wrap } from "./svg";
import { drawTable, tableHeight, tableWhole } from "./table";
import {
  drawCycle,
  drawHydrograph,
  drawLayers,
  drawParticles,
  drawRiver,
  drawTimeline,
} from "./templates";

export {
  answerPart,
  buildCount,
  buildsOn,
  hasAnswerPart,
  hasRevealPart,
  part,
  REVEAL_HIDDEN,
  stripBuilds,
  svgAtBuild,
  svgOfDataUrl,
  withBuilds,
} from "./builds";
export { pileSpec, UNSHARED_ASK } from "./groups";
export { mendParticleLabels, particleLabelFaults } from "./labels3";
export {
  CHARS_PER_WORD,
  captionRule,
  type DiagramSlot,
  fitsMeasured,
  LIMIT_TEXT,
  LIMITS,
  limitLines,
  measuredLabel,
  SLOT_LIMITS,
  type SlotLimit,
  type StageGroup,
  slotBox,
  slotLimit,
  slotLimitLine,
  slotOf,
  stageGroup,
  wordsFor,
} from "./limits";
export {
  CHANGE_WORD,
  drawerSchema,
  flowShape,
  fromMeaning,
  MEANING_SCHEMAS,
  meaningFaults,
  timeOf,
  withAskedCounts,
} from "./meaning";
export { MEANING_SAMPLES } from "./meaning-samples";
export {
  areaModelTable,
  energyProfileOf,
  isHydrograph,
  isParticleRow,
  mendSpec,
  normaliseDiagram,
  oneStateCompare,
  particleTitle,
  shadedFractionLabels,
  simplerDiagrams,
  withTangents,
  yearOf,
} from "./normalise";
export { DIAGRAM_SAMPLES } from "./samples";
export * from "./schema";
export { LONG_LABEL_STRETCH } from "./stretch";
export { TYPE_FLOOR } from "./style";
export { TEMPLATE_SPECS } from "./template-specs";

/** The modern looks' inset between a drawing and its zone's left and right edges, in points. */
export const DRAW_INSET = 4;

/** The drawn diagram's name in the layers list; present, export and print show it. */
export const DIAGRAM_DRAWN_NAME = "Diagram";
export { titleAddsInformation, withoutEchoTitle } from "./echo-title";
/** A theme font stack as the family an SVG names (the `var(--font-*)` part resolved). */
export { family as svgFontFamily, hasAdvances } from "./svg";

/**
 * `spec` in the form the drawer parses. Round 8: a spec in its meaning form (meaning.ts) is drawn
 * from the form code derives. diagrams-11: a particles spec that misses its own limits by a little
 * is mended (particles-mend.ts), not dropped. Every spec that already parses comes back as is.
 */
function drawable(spec: unknown): unknown {
  const drawn = fromMeaning(clipParticleLists(spec));
  const mended = mendParticles(drawn, LONG_LABEL_STRETCH);
  // A key cut to two names is then held to the labels3 rules like any other (labels3.ts).
  return mended === drawn ? drawn : mendParticleLabels(mended);
}

/** `spec` parsed, or `undefined` when it is not a diagram spec. */
export function parseDiagram(spec: unknown): DiagramSpec | undefined {
  spec = drawable(spec);
  // BAKEOFF base4f (unshared): a one-group pile is drawn as is (groups.ts `pileSpec`).
  if ((spec as { pile?: unknown })?.pile === true) {
    const p = spec as { kind?: unknown; total?: unknown; groups?: unknown };
    if (p.kind === "equal-groups" && p.groups === 1 && typeof p.total === "number")
      return spec as DiagramSpec;
  }
  const r = DiagramSpecSchema.safeParse(spec);
  if (r.success) return r.data;
  return longLabels > 0 ? parseLong(spec, r.error.issues).spec : undefined;
}

/** The smallest label size a long label may shrink to (the renderers' own floor). */
const LONG_LABEL_MIN_FS = 16;
let longLabels = 0;

/** Run `f` with labels up to `LONG_LABEL_STRETCH` times their limit parsing (synchronous). */
export function withLongLabels<T>(f: () => T): T {
  longLabels += 1;
  try {
    return f();
  } finally {
    longLabels -= 1;
  }
}

/** A spec whose only faults are labels a little over their limit (stretch.ts), or the reasons. */
function parseLong(
  spec: unknown,
  issues: Parameters<typeof parseStretched>[2],
): { spec?: DiagramSpec; reasons: string[] } {
  const r = parseStretched(DiagramSpecSchema, spec, issues);
  return { spec: r.data, reasons: r.reasons };
}

/**
 * lab/t3: the drawing for `spec` in `rect`, fitting labels a little over their limit before giving
 * up: the label is drawn whole (the renderers wrap it), at the slot's label size or a step smaller
 * down to the renderers' floor, and only when it draws with no label cut, off the drawing or
 * overlapping on EVERY theme. Nothing is shortened. A spec that already parses is drawn as before
 * (settled, unstretched). `reasons` says why one could not be fitted, for the log.
 */
/** lab/t3 fit-fix: a table spec draws whole in a `w` x `h` zone on `theme` (no column clipped). */
export function tableDrawsWhole(spec: unknown, theme: Theme, w: number, h: number): boolean {
  const s = parseDiagram(spec);
  if (!s || s.kind !== "table") return true;
  return tableWhole(s, context(theme, Math.round(w), Math.round(h)), w, h);
}

/**
 * lab/t3 fit-fix: the height a table spec takes drawn whole `w` wide on `theme` (its title's lines
 * included), or undefined when it cannot draw whole at that width within `h`.
 */
export function tableDrawnHeight(
  spec: unknown,
  theme: Theme,
  w: number,
  h: number,
  fs?: number,
): number | undefined {
  const s = parseDiagram(spec);
  if (s?.kind !== "table") return undefined;
  const x = context(theme, Math.round(w), Math.round(h), fs);
  const title = s.title ? Math.ceil(x.fs * 1.1 * 1.7 + x.fs * 1.2) : 0;
  const ih = h - title;
  if (ih <= 0 || !tableWhole(s, x, w, ih)) return undefined;
  const need = title + tableHeight(s, x, w, ih);
  return need <= h ? need : undefined;
}

/** The type size a drawing takes in a `w` x `h` zone on `theme` (to keep it when the zone closes up). */
export function diagramFs(theme: Theme, w: number, h: number): number {
  return context(theme, Math.round(w), Math.round(h)).fs;
}

export function fittedDiagramElement(
  spec: unknown,
  theme: Theme,
  rect: { x: number; y: number; w: number; h: number },
  ids: () => string = uid,
):
  | { ok: true; element: ImageElement; stretched: boolean; fs?: number }
  | { ok: false; reasons: string[] } {
  spec = drawable(spec);
  const strict = DiagramSpecSchema.safeParse(spec);
  if (strict.success) {
    const element = diagramElement(settleDiagram(strict.data, rect).spec, theme, rect, ids);
    return element
      ? { ok: true, element, stretched: false }
      : { ok: false, reasons: ["it does not draw"] };
  }
  const long = parseLong(spec, strict.error.issues);
  if (!long.spec) return { ok: false, reasons: long.reasons };
  const parsed = long.spec;
  const size = { w: rect.w, h: rect.h };
  const base = context(theme, Math.round(rect.w), Math.round(rect.h)).fs;
  let last: string[] = [];
  for (let fs = base; fs >= LONG_LABEL_MIN_FS; fs -= 2) {
    const faults = withLongLabels(() =>
      THEMES.flatMap((t) => diagramFaults(parsed, t, { ...size, fs })),
    );
    if (faults.length === 0) {
      const element = withLongLabels(() => diagramElement(parsed, theme, { ...rect, fs }, ids));
      if (element) return { ok: true, element, stretched: true, fs };
    }
    last = [...new Set(faults)];
  }
  return { ok: false, reasons: last.length > 0 ? last : ["it does not draw"] };
}

function body(
  s: DiagramSpec,
  t: Theme,
  w: number,
  h: number,
  probe?: {
    rec: DrawnText[];
    strokes: [number, number, number, number][];
    ih: number;
    faults: string[];
    arrows?: Ctx["arrows"];
    axes?: Ctx["axes"];
    leaders?: Ctx["leaders"];
    parts?: Ctx["parts"];
  },
  fs?: number,
): string {
  const x = context(t, w, h, fs);
  let top = 0;
  let head = "";
  if (s.title) {
    // A title is never cut (C2, B0's y4 tables): one line at its own size, else two lines, else
    // two lines at the body size; only a title past all three keeps the ellipsis.
    // Drawn in the heading family and measured with its advances (`titleCtx`).
    const tx = titleCtx(x);
    const whole = (fs: number, n: number) => {
      const l = wrap(s.title as string, tx, w, n, fs, 700);
      return l[l.length - 1]?.endsWith("…") ? undefined : l;
    };
    const big = Math.round(x.fs * 1.1);
    const fit = (whole(big, 1) && { fs: big, lines: whole(big, 1) as string[] }) ||
      (whole(big, 2) && { fs: big, lines: whole(big, 2) as string[] }) ||
      (whole(x.fs, 2) && { fs: x.fs, lines: whole(x.fs, 2) as string[] }) || {
        fs: x.fs,
        lines: wrap(s.title, tx, w, 2, x.fs, 700),
      };
    const { fs, lines } = fit;
    head = text(tx, w / 2, 0, lines, {
      v: "top",
      fs,
      weight: WEIGHT.title,
      fill: t.colors.heading ?? t.colors.ink,
    });
    top = fs * 1.7 + (lines.length - 1) * fs * 1.2;
  }
  const ih = h - top;
  if (probe) probe.ih = ih;
  const ix = probe
    ? {
        ...x,
        rec: probe.rec,
        strokes: probe.strokes,
        faults: probe.faults,
        arrows: probe.arrows,
        axes: probe.axes,
        leaders: probe.leaders,
        parts: probe.parts,
      }
    : x;
  // Modern looks: the drawing keeps an inset from its zone's left and right edges, so no label,
  // axis title or bar name touches them.
  // A river scene places its names against its own drawn margins, so it keeps the full width.
  const inset = look().preset === "current" || s.kind === "river" ? 0 : DRAW_INSET;
  const wi = w - 2 * inset;
  const marks = probe
    ? {
        rec: probe.rec.length,
        strokes: probe.strokes.length,
        arrows: probe.arrows?.length ?? 0,
        leaders: probe.leaders?.length ?? 0,
        parts: probe.parts?.length ?? 0,
      }
    : undefined;
  const inner = (() => {
    switch (s.kind) {
      case "bar-model":
        return drawBarModel(s, ix, wi, ih);
      case "line-graph":
        return drawLineGraph(s, ix, wi, ih);
      case "flow":
        return drawFlow(s, ix, wi, ih);
      case "labelled-diagram":
        return drawLabelled(s, ix, wi, ih);
      case "number-line":
        return drawNumberLine(s, ix, wi, ih);
      case "table":
        return drawTable(s, ix, wi, ih);
      case "particles":
        return drawParticles(s, ix, wi, ih);
      case "hydrograph":
        return drawHydrograph(s, ix, wi, ih);
      case "timeline":
        return drawTimeline(s, ix, wi, ih);
      case "layers":
        return drawLayers(s, ix, wi, ih);
      case "cycle":
        return drawCycle(s, ix, wi, ih);
      case "river":
        return drawRiver(s, ix, wi, ih);
      case "bar-chart":
        return drawBarChart(s, ix, wi, ih);
      case "pie":
        return drawPie(s, ix, wi, ih);
      case "venn":
        return drawVenn(s, ix, wi, ih);
      case "carroll":
        return drawCarroll(s, ix, wi, ih);
      case "cubes":
        return drawCubes(s, ix, wi, ih);
      case "equal-groups":
        return drawEqualGroups(s, ix, wi, ih);
      case "fraction-shapes":
        return drawFractionShapes(s, ix, wi, ih);
    }
  })();
  if (inset && probe && marks) {
    for (const r of probe.rec.slice(marks.rec)) {
      r.x0 += inset;
      r.x1 += inset;
    }
    for (const sg of probe.strokes.slice(marks.strokes)) {
      sg[0] += inset;
      sg[2] += inset;
    }
    for (const a of probe.arrows?.slice(marks.arrows) ?? []) {
      a.tip = [a.tip[0] + inset, a.tip[1]];
      a.target = { ...a.target, x0: a.target.x0 + inset, x1: a.target.x1 + inset };
    }
    for (const l of probe.leaders?.slice(marks.leaders) ?? []) {
      l[0] += inset;
      l[2] += inset;
    }
    for (const pts of probe.parts?.slice(marks.parts) ?? []) for (const q of pts) q[0] += inset;
  }
  const fin = finished(laddered(inner), x.c, mix, x.dark);
  const drawn = inset ? `<g transform="translate(${n(inset)},0)">${fin}</g>` : fin;
  return top ? `${head}<g transform="translate(0,${n(top)})">${drawn}</g>` : drawn;
}

/**
 * The spec drawn as an SVG document `w`×`h` slide points, or `undefined` when the spec does not
 * parse (or, defensively, a renderer throws). Pure and deterministic.
 */
export function renderDiagram(
  spec: unknown,
  theme: Theme,
  size: { w: number; h: number; fs?: number },
): string | undefined {
  const s = parseDiagram(spec);
  const w = Math.round(size.w);
  const h = Math.round(size.h);
  if (!s || !(w >= 80) || !(h >= 60)) return undefined;
  try {
    const inner = body(s, theme, w, h, undefined, size.fs);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(s.alt)}"><title>${esc(s.alt)}</title>${inner}</svg>`;
  } catch {
    return undefined;
  }
}

/** An SVG document as a data URL an `<img>` (and so an image element) can show. */
export const svgDataUrl = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** The most a drawing is enlarged to fill its zone. */
export const MAX_DIAGRAM_ZOOM = 1.8;
/**
 * FIX1: how much a drawing is enlarged to fill its zone. A bar model, a flow or a table draws at
 * its own type size and leaves most of a big zone empty; drawn in a smaller box with the zone's
 * shape and scaled up, it fills the zone, keeping its aspect. The largest zoom (to
 * `MAX_DIAGRAM_ZOOM`, in tenths) at which it still draws with no fault; 1 when none does, and for
 * kinds that already fill whatever box they get (`FILLS_BOX`).
 */
export function diagramZoom(
  spec: unknown,
  theme: Theme,
  rect: { w: number; h: number; fs?: number },
): number {
  const s = parseDiagram(spec);
  if (!s || FILLS_BOX.has(s.kind)) return 1;
  const up = cleanZooms(spec, theme, rect)[0];
  if (up) return up;
  // A bar model is read by its numbers: when its part labels do not fit even at its own size (the
  // larger key-stage type scale), it draws a step smaller (the largest zoom below 1 at
  // which every label fits) rather than dropping them.
  if (s.kind !== "bar-model" || diagramFaults(spec, theme, rect).length === 0) return 1;
  for (let z = 0.95; z >= MIN_BAR_ZOOM - 0.01; z = Math.round((z - 0.05) * 100) / 100) {
    const size = { w: rect.w / z, h: rect.h / z, fs: rect.fs };
    if (diagramFaults(spec, theme, size).length === 0) return z;
  }
  return 1;
}
/** The smallest step a bar model takes to keep every label (labels at 60 % of their own size). */
const MIN_BAR_ZOOM = 0.6;

/** The zooms (largest first, to `MAX_DIAGRAM_ZOOM`, in tenths) at which the drawing fills its zone with no fault. */
function cleanZooms(
  spec: unknown,
  theme: Theme,
  rect: { w: number; h: number; fs?: number },
): number[] {
  const out: number[] = [];
  const bar = parseDiagram(spec)?.kind === "bar-model";
  for (let z = MAX_DIAGRAM_ZOOM; z > 1.05; z = Math.round((z - 0.1) * 10) / 10) {
    const size = { w: rect.w / z, h: rect.h / z, fs: rect.fs };
    if (size.w < 80 || size.h < 60) continue;
    // A bar model spans its box by design (its bars run edge to edge), so it has no fill cap.
    if (
      diagramFaults(spec, theme, size).length === 0 &&
      (bar || (drawnFill(spec, theme, size) ?? 0) <= 0.92)
    )
      out.push(z);
  }
  return out;
}

/**
 * fix-bars: the label size a drawing shows on the slide in `rect`, in slide points: its own label
 * size at the zoom it takes, times that zoom.
 */
export function shownLabelSize(
  spec: unknown,
  theme: Theme,
  rect: { w: number; h: number; fs?: number },
): number {
  const z = diagramZoom(spec, theme, rect);
  return context(theme, Math.round(rect.w / z), Math.round(rect.h / z), rect.fs).fs * z;
}

/**
 * fix-bars (FULL-RUN y5): a bar model is read by its numbers, so its part labels, row names and
 * total stand at the slide's body size. It draws at body size in `rect` when some zoom that shows
 * its labels at least that large draws it with no fault (every part label inside its part). A bar
 * model that does not (eight parts of "5 cm" in a half zone) takes the full-width zone instead.
 * Other kinds keep their own label sizes: always true.
 */
export function drawsAtBodySize(
  spec: unknown,
  theme: Theme,
  rect: { w: number; h: number; fs?: number },
): boolean {
  const s = parseDiagram(spec);
  if (s?.kind !== "bar-model") return true;
  const body = theme.sizes.body * 0.95;
  const shown = (z: number) =>
    context(theme, Math.round(rect.w / z), Math.round(rect.h / z), rect.fs).fs * z;
  if (shown(1) >= body && diagramFaults(spec, theme, rect).length === 0) return true;
  return cleanZooms(spec, theme, rect).some((z) => shown(z) >= body);
}

/**
 * The spec as an image element filling `rect`, or `undefined` when it does not draw. The element
 * is named `Diagram` (not the placeholder's name), so every surface shows it.
 */
export function diagramElement(
  spec: unknown,
  theme: Theme,
  rect: { x: number; y: number; w: number; h: number; fs?: number },
  ids: () => string = uid,
): ImageElement | undefined {
  const s = parseDiagram(spec);
  const zoom = s ? diagramZoom(spec, theme, rect) : 1;
  const svg =
    zoom !== 1
      ? renderDiagram(spec, theme, { w: rect.w / zoom, h: rect.h / zoom, fs: rect.fs })?.replace(
          /width="[\d.]+" height="[\d.]+"/,
          `width="${Math.round(rect.w)}" height="${Math.round(rect.h)}"`,
        )
      : renderDiagram(spec, theme, rect);
  if (!svg || !s) return undefined;
  return {
    id: ids(),
    type: "image",
    name: DIAGRAM_DRAWN_NAME,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    src: svgDataUrl(svg),
    alt: s.alt,
    fit: "contain",
    // What it was drawn from (TEACH-97 part h), with the label size the fit settled on and whether
    // it parsed only with long labels, so `redrawDiagram` gives back this exact drawing.
    diagram: {
      kind: "drawer",
      spec: s as Record<string, unknown>,
      ...(rect.fs !== undefined ? { fs: rect.fs } : {}),
      ...(longLabels > 0 && !DiagramSpecSchema.safeParse(s).success ? { longLabels: true } : {}),
    },
  } as ImageElement;
}

/**
 * A drawer diagram drawn again from its stored source (TEACH-97 part h) in `rect`, in the stored
 * label size and long-label mode: the same drawing as when it was placed, for the same rect and
 * theme. `undefined` when the spec no longer draws.
 */
export function redrawDiagram(
  source: Extract<DiagramSource, { kind: "drawer" }>,
  theme: Theme,
  rect: { x: number; y: number; w: number; h: number },
  ids: () => string = uid,
): ImageElement | undefined {
  const draw = () =>
    diagramElement(
      source.spec,
      theme,
      { ...rect, ...(source.fs !== undefined ? { fs: source.fs } : {}) },
      ids,
    );
  return source.longLabels ? withLongLabels(draw) : draw();
}

/**
 * What is wrong with a spec drawn `size`, in words the writer can act on;
 * empty when nothing is. A diagram that draws is not a pass on its own: labels that collide, run
 * off the drawing or are cut short, and panels meant to differ that draw the same, are faults.
 */
/** What a renderer records about its own drawing when asked (`diagramFaults`, the geometry checks). */
export type DiagramProbe = {
  rec: DrawnText[];
  strokes: [number, number, number, number][];
  ih: number;
  faults: string[];
  arrows: NonNullable<Ctx["arrows"]>;
  axes: NonNullable<Ctx["axes"]>;
  leaders: NonNullable<Ctx["leaders"]>;
  parts: NonNullable<Ctx["parts"]>;
};
const diagramProbe = (h: number): DiagramProbe => ({
  rec: [],
  strokes: [],
  ih: h,
  faults: [],
  arrows: [],
  axes: [],
  leaders: [],
  parts: [],
});
let lastProbe: DiagramProbe | undefined;
/** The probe of the last `diagramFaults` call (the geometry checks read arrows and axes from it). */
export const lastDiagramProbe = (): DiagramProbe | undefined => lastProbe;

export function diagramFaults(
  spec: unknown,
  theme: Theme,
  size: { w: number; h: number; fs?: number },
): string[] {
  const s = parseDiagram(spec);
  const w = Math.round(size.w);
  const h = Math.round(size.h);
  if (!s || !(w >= 80) || !(h >= 60)) return ["it does not draw"];
  const probe = diagramProbe(h);
  try {
    body(s, theme, w, h, probe, size.fs);
  } catch {
    return ["it does not draw"];
  }
  const { rec, strokes, ih } = probe;
  lastProbe = probe;
  const out: string[] = [...probe.faults];
  // A label set across a line of the drawing (an outline, a river, an arrow) reads as clutter and
  // hides what the line shows (F1 y8 drainage basin): its box, less a small margin, is crossed.
  const crosses = (b: DrawnText, [ax, ay, bx, by]: [number, number, number, number]) => {
    for (let t = 0; t <= 1; t += 1 / 40) {
      const px = ax + (bx - ax) * t;
      const py = ay + (by - ay) * t;
      if (px > b.x0 + 3 && px < b.x1 - 3 && py > b.y0 + 4 && py < b.y1 - 4) return true;
    }
    return false;
  };
  for (const b of rec) {
    if (strokes.some((sg) => crosses(b, sg)))
      out.push(`the label "${b.text}" sits across a line of the drawing`);
  }
  const area = (b: DrawnText) => Math.max(1, (b.x1 - b.x0) * (b.y1 - b.y0));
  const over = (a: DrawnText, b: DrawnText) =>
    Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
    Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  for (const b of rec) {
    if (b.cut) out.push(`the label "${b.text}" is cut short`);
    if (b.x0 < -2 || b.x1 > w + 2 || b.y0 < -2 || b.y1 > ih + 2)
      out.push(`the label "${b.text}" runs off the drawing`);
  }
  for (let i = 0; i < rec.length; i++) {
    for (let j = i + 1; j < rec.length; j++) {
      const a = rec[i] as DrawnText;
      const b = rec[j] as DrawnText;
      if (over(a, b) > 0.15 * Math.min(area(a), area(b)))
        out.push(`the labels "${a.text}" and "${b.text}" overlap`);
    }
  }
  out.push(...samePanels(s));
  return [...new Set(out)];
}

/** Panels meant to differ that draw the same: two particle boxes alike, or two series alike. */
function samePanels(s: DiagramSpec): string[] {
  const out: string[] = [];
  // r3-diag: compare panels that differ in nothing drawn (no count, extra, speed or room
  // difference) show no difference, whatever their captions say.
  if (s.kind === "particles" && s.show === "compare" && s.panels) {
    const keyOf = (q: NonNullable<typeof s.panels>[number]) =>
      JSON.stringify([
        q.state,
        q.count,
        q.extra,
        q.room,
        q.speed ?? (s.motion ? "slow" : ""),
        q.energy,
      ]);
    if (new Set(s.panels.map(keyOf)).size === 1)
      out.push("the compare panels draw exactly the same, so the picture shows no difference");
  }
  if (s.kind === "labelled-diagram") {
    const boxes = s.shapes.flatMap((sh) => (sh.type === "particles" ? [sh] : []));
    const near = (a: number, b: number) => Math.abs(a - b) <= 0.15 * Math.max(a, b);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a && b && a.arrangement === b.arrangement && near(a.w, b.w) && near(a.h, b.h)) {
          out.push(
            `two particle boxes draw exactly the same (${a.arrangement}, the same size), so the picture shows no difference between them`,
          );
        }
      }
    }
  }
  if (s.kind === "line-graph") {
    const key = (pts: unknown) => JSON.stringify(pts);
    const seen = new Set<string>();
    for (const series of s.series) {
      const k = key(series.points);
      if (seen.has(k)) out.push("two series draw the same line, so the graph shows no difference");
      seen.add(k);
    }
  }
  return [...new Set(out)];
}

/**
 * The spec code will draw: normalised, then the first simpler form that draws without a
 * fault at `size` on EVERY theme (a teacher may switch theme later), else the normalised one.
 * `rung` says which form was taken (0 = as normalised); `clean` whether it passes everywhere.
 */
export function settleDiagram(
  spec: unknown,
  size: { w: number; h: number },
): { spec: unknown; rung: number; clean: boolean } {
  const forms = simplerDiagrams(spec);
  for (const [rung, f] of forms.entries()) {
    if (THEMES.every((t) => diagramFaults(f, t, size).length === 0))
      return { spec: f, rung, clean: true };
  }
  return { spec: forms[0] ?? spec, rung: 0, clean: false };
}

/** Kinds whose drawing fills whatever box it gets (a plot, a scene): kept, at most 0.85 as tall as wide. */
const FILLS_BOX = new Set([
  // Plots keep their box: a chart cut to its smallest clean height squashes its scale.
  "bar-chart",
  "venn",
  // A timeline keeps its box and stands in its middle: its type sized up to fill it.
  "timeline",
  "pie",
  "line-graph",
  "hydrograph",
  "labelled-diagram",
  "river",
  "cubes",
  "cycle",
  "layers",
  "particles",
]);

/**
 * The height a spec needs drawn `size.w` wide, at the label size of its full `size` box (UX ruling
 * 155: the figure's card is sized to its drawing, not run to the foot of the slide). A table takes
 * its own rows; a plot or scene keeps its box, capped at 0.85 of its width; anything else takes the
 * smallest height at which it draws with no fault. Never more than `size.h`.
 */
export function drawingHeight(
  spec: unknown,
  theme: Theme,
  size: { w: number; h: number },
): { h: number; fs: number } {
  const s = parseDiagram(spec);
  const fs = context(theme, size.w, size.h).fs;
  if (!s) return { h: size.h, fs };
  if (FILLS_BOX.has(s.kind)) return { h: Math.min(size.h, Math.round(size.w * 0.85)), fs };
  if (s.kind === "table") {
    for (let h = 80; h < size.h; h += 8) {
      const probe = { rec: [] as DrawnText[], strokes: [], ih: h, faults: [] as string[] };
      body(s, theme, size.w, h, probe, fs);
      const x = context(theme, size.w, h, fs);
      if (
        tableHeight(s, x, size.w, size.h) <= probe.ih &&
        diagramFaults(spec, theme, { w: size.w, h, fs }).length === 0
      ) {
        return { h: h + 8, fs };
      }
    }
    return { h: size.h, fs };
  }
  for (let h = 120; h < size.h; h += 12) {
    if (diagramFaults(spec, theme, { w: size.w, h, fs }).length === 0) return { h, fs };
  }
  return { h: size.h, fs };
}
export {
  capacityLine,
  DIAGRAM_ZONES,
  type DiagramZones,
  diagramCapacities,
  itemCount,
  zoneShape,
} from "./capacity";

/**
 * lab/cand: how much of a `size` zone the spec's drawing covers: the bounding box of its words
 * and recorded strokes against the zone under its title, 0 to 1. Undefined when it does not draw.
 * Kinds whose shapes the probe does not record (`SPARSE_FILL` leaves them out) read low here.
 */
export function drawnFill(
  spec: unknown,
  theme: Theme,
  size: { w: number; h: number },
): number | undefined {
  const s = parseDiagram(spec);
  const w = Math.round(size.w);
  const h = Math.round(size.h);
  if (!s || !(w >= 80) || !(h >= 60)) return undefined;
  const probe = diagramProbe(h);
  try {
    body(s, theme, w, h, probe);
  } catch {
    return undefined;
  }
  let [x0, y0, x1, y1] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, -1, -1];
  for (const r of probe.rec)
    [x0, y0, x1, y1] = [
      Math.min(x0, r.x0),
      Math.min(y0, r.y0),
      Math.max(x1, r.x1),
      Math.max(y1, r.y1),
    ];
  for (const [ax, ay, bx, by] of probe.strokes)
    [x0, y0, x1, y1] = [
      Math.min(x0, ax, bx),
      Math.min(y0, ay, by),
      Math.max(x1, ax, bx),
      Math.max(y1, ay, by),
    ];
  if (x1 < x0 || y1 < y0) return 0;
  const cw = Math.min(w, x1) - Math.max(0, x0);
  const ch = Math.min(probe.ih, y1) - Math.max(0, y0);
  return Math.max(0, Math.min(1, (cw * ch) / (w * Math.max(1, probe.ih))));
}

/**
 * The share of a full-width zone below which a kind's drawing is sparse there: a 3-box chain
 * drawn across the slide is a strip with empty space above and below (0.17). Only kinds whose
 * labels and strokes outline the drawing are listed; pies, Venn, bar charts and the like draw
 * shapes the probe does not record and are never called sparse.
 */
export const SPARSE_FILL: Partial<Record<DiagramSpec["kind"], number>> = {
  flow: 0.35,
  timeline: 0.35,
  "number-line": 0.2,
  "bar-model": 0.3,
  table: 0.3,
};

/** Whether the spec drawn in `size` covers less of it than its kind's `SPARSE_FILL`. */
export function sparseDrawing(
  spec: unknown,
  theme: Theme,
  size: { w: number; h: number },
): boolean {
  const kind = parseDiagram(spec)?.kind;
  const min = kind ? SPARSE_FILL[kind] : undefined;
  if (min === undefined) return false;
  const f = drawnFill(spec, theme, size);
  return f !== undefined && f < min;
}

export { type DrawnDiagram, drawDiagram, readabilityFaults } from "./draw";
export { figureGeometryFaults } from "./geometry";
/** Label width from the font advance tables (the library renderer measures with it, TEACH-247 part h). */
export { textWidth } from "./svg";
export {
  DiagramWireSchema,
  diagramJsonSchema,
  diagramWireSchema,
  drawerJsonSchema,
  dropNulls,
  openaiForm,
  openaiSchemaFaults,
  relaxed,
  strictForm,
} from "./wire";
