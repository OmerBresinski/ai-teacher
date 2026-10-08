/**
 * BAKEOFF labels3 arm (rootcause/faults-3-6-8.txt, fault 3). Behind one process-wide switch, off by
 * default, so every other arm draws byte for byte as before. The diagram-spec fill pours spare labels
 * into particles slots that the drawer draws literally; this mend keeps them out:
 *  - `arrows` on show=compare: the drawer puts an arrow and its words BETWEEN the panels, but compare
 *    panels are not a process ("short, medium, long" under an arrow). Dropped.
 *  - `key`: the drawer gives key[0] the particle colour and key[1] the second-kind colour (accent2).
 *    An entry naming a drawing element or a non-particle ("Motion arrows", "Mg surface", "magnesium")
 *    is never shown as a particle swatch: a surface name moves to `lump` when a panel draws one, and
 *    the key keeps only what is drawn in its colour. A compare with no second kind (no `extra`) draws
 *    one particle colour, so a two-swatch key there can only mislead. A key stays only when both
 *    names are particles drawn in their swatch colours; otherwise it goes (the pair cannot hold one).
 *  - `notes` on show=compare: one note per panel, by index. A list whose length differs from the
 *    panels holds shared facts ("Same temperature", "Equal volume"): one would sit under one panel
 *    only and the rest be dropped. So does a list with any shared fact in it ("Same temperature",
 *    "Both at 20°C"), even one note per panel. Dropped.
 *  - `lump`: a lump named for a drawing element ("Motion arrows") is dropped.
 */
let on = false;
/** Turn the labels3 mend on or off (run.ts sets it once for `--code-arm labels3`). */
export function setParticleLabelMend(v: boolean): void {
  on = v;
}
export const particleLabelMend = (): boolean => on;

/** A key or lump name that is not a particle: a drawing element, a surface or a solid. */
export const NON_PARTICLE =
  /\barrows?\b|\bsurface\b|\bmagnesium\b|\bMg\b|\bstrip\b|\blump\b|\bsolid\b|\bribbon\b|\bmarble|\bchips?\b|\bpowder\b|\blid\b|\bpiston\b|\bcontainer\b/i;
/** A name for a drawing element only (never a lump either). */
const DRAWING = /\barrows?\b|\blines?\b|\bmarks?\b|\btrails?\b/i;
const SURFACE =
  /\bsurface\b|\bmagnesium\b|\bMg\b|\bstrip\b|\blump\b|\bsolid\b|\bribbon\b|\bmarble|\bchips?\b|\bpowder\b/i;

/** A key name for particles: names particles (or atoms, ions, molecules) and no drawing element. */
const isParticle = (t: string) =>
  !DRAWING.test(t) && (/particle|molecule|\bions?\b|atoms?\b/i.test(t) || !NON_PARTICLE.test(t));

/** A note true of every panel, not of the one it would sit under. */
export const SHARED = /^\s*(same|equal|both|all|each|identical|constant)\b/i;

type P = {
  kind?: unknown;
  show?: unknown;
  panels?: { extra?: number; solid?: boolean }[];
  arrows?: string[];
  key?: [string, string];
  notes?: string[];
  lump?: string;
  [k: string]: unknown;
};

/** The labels3 mend of one spec (identity unless the switch is on and the spec is particles). */
export function mendParticleLabels(spec: unknown): unknown {
  if (!on) return spec;
  const s0 = spec as P;
  if (!s0 || typeof s0 !== "object" || s0.kind !== "particles") return spec;
  const s: P = { ...s0 };
  let changed = false;
  const compare = s.show === "compare" && Array.isArray(s.panels);
  if (compare && s.arrows !== undefined) {
    delete s.arrows;
    changed = true;
  }
  if (typeof s.lump === "string" && DRAWING.test(s.lump)) {
    delete s.lump;
    changed = true;
  }
  if (Array.isArray(s.key) && s.key.length === 2) {
    const [a, b] = s.key;
    const aPart = isParticle(a);
    const bPart = isParticle(b);
    const solid = compare && (s.panels ?? []).some((p) => p?.solid);
    const toLump = (t: string) => {
      if (solid && !s.lump && SURFACE.test(t) && !DRAWING.test(t)) s.lump = t;
    };
    const secondKind = compare ? (s.panels ?? []).some((p) => (p?.extra ?? 0) > 0) : true;
    if (!aPart || !bPart || !secondKind) {
      // Only names of particles drawn in that key colour stay. A pair schema cannot hold one name,
      // so a key with fewer than two particle kinds goes, and the surface name moves to the lump.
      if (!aPart) toLump(a);
      if (!bPart) toLump(b);
      delete s.key;
      changed = true;
    }
  }
  if (
    compare &&
    Array.isArray(s.notes) &&
    (s.notes.length !== (s.panels ?? []).length || s.notes.some((x) => SHARED.test(String(x))))
  ) {
    delete s.notes;
    changed = true;
  }
  return changed ? s : spec;
}
