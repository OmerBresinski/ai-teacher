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
import {
  diagramElement,
  mendSpec,
  parseDiagram,
  simplerDiagrams,
  svgDataUrl,
  withLongLabels,
} from "./index";
import { resolveLabels } from "./labelled";
import {
  clashPair,
  diagramPolish,
  dropLabels,
  isProtectedLabel,
  labelGate,
  reportLabelDrop,
  withDiagramPolish,
} from "./polish";
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
      /** polish2: clashing labels left out so the drawing could stay. */
      droppedLabels?: string[];
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
      // polish2 (D30): a label clash never costs the drawing. With every refit tried, the first form
      // and size whose only faults are clashes draws, and one label of each clashing pair goes.
      // D31 fix: a protected label (an objective word, a key term, a word the slide asks about) is
      // never the one that goes. Its clash is refitted harder first (each side, nudged along its
      // shape, with a leader, down to the kit minimum); then only an unprotected partner may go;
      // failing both, the diagram is drawn as base4 draws it.
      if (diagramPolish() && labelGate() === "label")
        for (const [rung, form] of forms.entries()) {
          if (!parseDiagram(form)) continue;
          for (let fs = base.fs; fs >= floor; fs -= 1) {
            const faults = readabilityFaults(form, theme, { w: rect.w, h: rect.h, fs });
            const pairs = faults.map(clashPair);
            if (!faults.length || pairs.some((p) => !p)) continue;
            const clashes = pairs as [string, string][];
            const alt = String((form as { alt?: unknown }).alt ?? "");
            const prot = (l: string) => isProtectedLabel(l);
            const guarded = clashes.filter((p) => prot(p[0]) || prot(p[1]));
            if (guarded.length) {
              const moved = refitLabels(form, clashes, theme, rect, base.fs, floor);
              if (moved) {
                const el = diagramElement(moved.form, theme, { ...rect, fs: moved.fs }, ids);
                if (el) {
                  for (const [a, b] of guarded)
                    reportLabelDrop({
                      label: prot(a) ? a : b,
                      clash: prot(a) ? b : a,
                      alt,
                      outcome: "refit",
                    });
                  return { ok: true, element: el, fs: moved.fs, rung, spec: moved.form };
                }
              }
              if (guarded.some(([a, b]) => prot(a) && prot(b))) {
                for (const [a, b] of guarded)
                  reportLabelDrop({ label: a, clash: b, alt, outcome: "base4" });
                return withDiagramPolish(false, () => drawDiagram(spec, theme, rect, ids));
              }
            }
            const element = diagramElement(form, theme, { ...rect, fs }, ids);
            if (!element) continue;
            // Of each clashing pair the unprotected label goes, else the shorter (a tick number
            // before an axis title).
            const go: string[] = [];
            const shorter = (p: [string, string]) =>
              prot(p[0]) ? p[1] : prot(p[1]) ? p[0] : p[1].length <= p[0].length ? p[1] : p[0];
            for (const p of clashes)
              if (!go.includes(p[0]) && !go.includes(p[1])) go.push(shorter(p));
            const src = element.src as string;
            const svg = decodeURIComponent(src.slice(src.indexOf(",") + 1));
            const cut = dropLabels(svg, go);
            for (const label of cut.dropped) {
              const pair = clashes.find((p) => p.includes(label));
              const clash = pair ? (pair[0] === label ? pair[1] : pair[0]) : "";
              reportLabelDrop({ label, clash, alt, outcome: "drop" });
            }
            return {
              ok: true,
              element: { ...element, src: svgDataUrl(cut.svg) },
              fs,
              rung,
              spec: form,
              droppedLabels: cut.dropped,
            };
          }
        }
      return { ok: false, reasons: last.length ? last : ["it does not draw"] };
    });
  } catch {
    return { ok: false, reasons: ["it does not draw"] };
  }
}

type LabelSpec = { text: string; at: [number, number]; side?: string };
const SIDES = ["top", "bottom", "left", "right"] as const;
const NUDGES: [number, number][] = [
  [0, 6],
  [0, -6],
  [6, 0],
  [-6, 0],
  [0, 12],
  [0, -12],
  [12, 0],
  [-12, 0],
];

/**
 * D31: the labelled-diagram forms that move the clashing labels and nothing else, least change
 * first: one label to another side, one label nudged along its shape (a leader then joins it to
 * its point), both labels of a pair to other sides, one to another side and the other nudged.
 */
export function labelMoves(form: unknown, clashes: [string, string][]): unknown[] {
  const f = form as { kind?: string; canvas?: string; labels?: LabelSpec[] };
  if (f?.kind !== "labelled-diagram" || !Array.isArray(f.labels)) return [];
  const labels = f.labels;
  const W = f.canvas === "wide" ? 160 : 100;
  const idx = (t: string) =>
    labels.findIndex((l) => l.text === t || t.startsWith(`${l.text} (`)) ?? -1;
  const with_ = (edits: [number, Partial<LabelSpec>][]) => ({
    ...f,
    labels: labels.map((l, i) => {
      const e = edits.find(([k]) => k === i)?.[1];
      return e ? { ...l, ...e } : l;
    }),
  });
  const sideOf = (i: number) => labels[i]?.side;
  const nudged = (i: number, [dx, dy]: [number, number]): Partial<LabelSpec> => {
    const [x, y] = (labels[i] as LabelSpec).at;
    return { at: [Math.min(W, Math.max(0, x + dx)), Math.min(100, Math.max(0, y + dy))] };
  };
  const out: unknown[] = [];
  const seen = new Set<string>();
  const add = (v: unknown) => {
    const k = JSON.stringify(v);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(v);
    }
  };
  const pairs = clashes
    .map(([a, b]) => [idx(a), idx(b)] as const)
    .filter(([a, b]) => a >= 0 && b >= 0);
  const one = [...new Set(pairs.flat())];
  for (const i of one) for (const s of SIDES) if (s !== sideOf(i)) add(with_([[i, { side: s }]]));
  for (const i of one) for (const d of NUDGES) add(with_([[i, nudged(i, d)]]));
  for (const [a, b] of pairs)
    for (const sa of SIDES)
      for (const sb of SIDES)
        add(
          with_([
            [a, { side: sa }],
            [b, { side: sb }],
          ]),
        );
  for (const [a, b] of pairs)
    for (const [p, q] of [
      [a, b],
      [b, a],
    ] as const)
      for (const s of SIDES)
        for (const d of NUDGES)
          add(
            with_([
              [p, { side: s }],
              [q, nudged(q, d)],
            ]),
          );
  return out;
}

/** The first label move (from the zone's size down to the kit minimum) that reads with no fault. */
function refitLabels(
  form: unknown,
  clashes: [string, string][],
  theme: Theme,
  rect: { w: number; h: number },
  top: number,
  floor: number,
): { form: unknown; fs: number } | undefined {
  // A nudge must not hand a label to another shape: each label keeps the shape it named.
  const targets = (f: unknown) => {
    const p = parseDiagram(f);
    return p?.kind === "labelled-diagram"
      ? JSON.stringify(resolveLabels(p as never).map((l) => [l.text, l.target]))
      : "";
  };
  const was = targets(form);
  const at = (v: unknown, fs: number) => readabilityFaults(v, theme, { w: rect.w, h: rect.h, fs });
  // The clashes left at the kit minimum (any other fault rules the move out).
  const left = (v: unknown): [string, string][] | undefined => {
    const p = at(v, floor).map(clashPair);
    return p.some((x) => !x) ? undefined : (p as [string, string][]);
  };
  // Of the single moves that clear every clash (at any size down to the kit minimum), the one that
  // strays least (refitCost), then the largest.
  const best1 = labelMoves(form, clashes)
    .filter((v) => targets(v) === was && left(v)?.length === 0)
    .flatMap((v) => {
      const sizes: { v: unknown; fs: number; lead: number }[] = [];
      for (let fs = top; fs >= floor; fs -= 1)
        if (!at(v, fs).length) sizes.push({ v, fs, lead: refitCost(form, v, theme, rect, fs) });
      return sizes;
    })
    .filter((c) => Number.isFinite(c.lead))
    .sort((a, b) => a.lead - b.lead || b.fs - a.fs)[0];
  if (best1) return { form: best1.v, fs: best1.fs };
  // Several clashes clear one move at a time: each round keeps the move that leaves the fewest.
  let cur = form;
  let open = clashes;
  for (let round = 0; round < 6 && open.length; round++) {
    let best: { v: unknown; c: [string, string][] } | undefined;
    for (const v of labelMoves(cur, open)) {
      if (targets(v) !== was) continue;
      const c = left(v);
      if (c && (!best || c.length < best.c.length)) best = { v, c };
      if (best && !best.c.length) break;
    }
    if (!best || best.c.length >= open.length) return undefined;
    cur = best.v;
    open = best.c;
  }
  if (open.length) return undefined;
  for (let fs = top; fs >= floor; fs -= 1) if (!at(cur, fs).length) return { form: cur, fs };
  return undefined;
}

/** A drawing's SVG text at `fs` (undefined when it does not draw). */
function svgAt(form: unknown, theme: Theme, rect: { w: number; h: number }, fs: number) {
  const el = diagramElement(form, theme, { x: 0, y: 0, w: rect.w, h: rect.h, fs }, () => "m");
  if (!el) return undefined;
  const src = String(el.src);
  return decodeURIComponent(src.slice(src.indexOf(",") + 1));
}
const attr = (k: string, t: string) => Number(new RegExp(`\\s${k}="([^"]*)"`).exec(t)?.[1]);

/** Each label's words and where its first line sits, in drawing px. */
export function labelSpots(svg: string): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  for (const m of svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) {
    const spans = [...(m[1] as string).matchAll(/<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/g)];
    if (!spans.length) continue;
    const words = spans.map((x) => x[2]).join(" ");
    const a = spans[0]?.[1] as string;
    out.set(words, [attr("x", a), attr("y", a)]);
  }
  return out;
}

/**
 * How far a refit strays: its leaders' summed length plus how far every label it did not move
 * shifted from where the clashing drawing set it (a move that pushes a neighbour off what it
 * names, "mon frère · ma sœur" beside Camille's dot, costs as much as a long leader).
 */
export function refitCost(
  form: unknown,
  moved: unknown,
  theme: Theme,
  rect: { w: number; h: number },
  fs: number,
): number {
  const after = svgAt(moved, theme, rect, fs);
  const before = svgAt(form, theme, rect, fs);
  if (!after || !before) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (const m of after.matchAll(/<line\b([^>]*)\/>\s*<circle\b([^>]*)\/>/g)) {
    const [x1, y1, x2, y2] = ["x1", "y1", "x2", "y2"].map((k) => attr(k, m[1] as string));
    if (x2 === attr("cx", m[2] as string) && y2 === attr("cy", m[2] as string))
      sum += Math.hypot((x2 as number) - (x1 as number), (y2 as number) - (y1 as number));
  }
  const f = form as { labels?: { text: string; side?: string; at?: unknown }[] };
  const g = moved as typeof f;
  const changed = new Set(
    (g.labels ?? [])
      .filter((l, i) => JSON.stringify(l) !== JSON.stringify(f.labels?.[i]))
      .map((l) => l.text),
  );
  const a = labelSpots(after);
  for (const [words, p] of labelSpots(before)) {
    const sp = (t: string) => t.replace(/\s+/g, " ").trim();
    if ([...changed].some((t) => sp(t) === sp(words) || sp(words).startsWith(`${sp(t)} (`)))
      continue;
    const q = a.get(words);
    sum += q ? Math.hypot(q[0] - p[0], q[1] - p[1]) : 200;
  }
  return sum;
}
