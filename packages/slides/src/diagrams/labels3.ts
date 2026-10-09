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
  panels?: { extra?: number; solid?: boolean; state?: string }[];
  captions?: string[];
  states?: string[];
  arrows?: string[];
  key?: [string, string];
  notes?: string[];
  lump?: string;
  [k: string]: unknown;
};

/** The labels3 mend of one spec, and why each slot it cleared was wrong (for the refusal). */
function inspect(spec: unknown): { out: unknown; why: string[] } {
  const s0 = spec as P;
  if (!s0 || typeof s0 !== "object" || s0.kind !== "particles") return { out: spec, why: [] };
  const s: P = { ...s0 };
  const why: string[] = [];
  let changed = false;
  const compare = s.show === "compare" && Array.isArray(s.panels);
  if (compare && s.arrows !== undefined) {
    if (s.arrows.length)
      why.push(
        "a compare draws no arrow between its panels (they are not a process): leave out `arrows`",
      );
    delete s.arrows;
    changed = true;
  }
  if (typeof s.lump === "string" && DRAWING.test(s.lump)) {
    why.push(`\`lump\` names the solid on the panel floor, never a drawing element ("${s.lump}")`);
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
      why.push(
        !secondKind && aPart && bPart
          ? "`key` names two particle kinds, but no panel draws a second kind (`extra`): leave out `key`"
          : `\`key\` names only particle kinds that are drawn, never a surface, lump or arrow (${JSON.stringify(s.key)}); name a solid in \`lump\``,
      );
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
    why.push(
      "`notes` holds exactly one note per panel, about that panel only; a fact true of every panel goes in the title",
    );
    delete s.notes;
    changed = true;
  }
  // D45 (chalkie2 judges, base7c y7 s4 and s5), show=states:
  //  - a panel whose caption names a different state from the one it draws ("Liquid particles stay
  //    close" over a gas panel, the spec's invented second panel) is dropped with its caption and note,
  //    while one panel is left;
  //  - `notes` sit under the panels by index, so a note about the drawing itself ("Dots are not real
  //    size", "Double arrows show vibration" landing under Gas) or a shared fact is never a panel's note.
  const states = s.show === "states" && Array.isArray(s.panels);
  if (states) {
    const STATE = /\b(solids?|liquids?|gas(es)?)\b/gi;
    const norm = (w: string) =>
      w
        .toLowerCase()
        .replace(/^solids$/, "solid")
        .replace(/^liquids$/, "liquid")
        .replace(/^gases$/, "gas");
    const panels = s.panels ?? [];
    const bad = panels
      .map((p, i) => {
        const named = [...String(s.captions?.[i] ?? "").matchAll(STATE)].map((m) => norm(m[0]));
        return named.length > 0 && p?.state && !named.includes(String(p.state)) ? i : -1;
      })
      .filter((i) => i >= 0);
    if (bad.length && bad.length < panels.length) {
      why.push(
        `a states panel's caption names the state it draws; panel ${bad.map((i) => i + 1).join(", ")} contradicts it: leave that panel out`,
      );
      const keep = (_: unknown, i: number) => !bad.includes(i);
      // `panels` needs two or more; one state left is drawn from `states` alone (its default panel).
      const left = panels.filter(keep);
      if (left.length >= 2) s.panels = left;
      else delete s.panels;
      if (Array.isArray(s.captions)) s.captions = s.captions.filter(keep);
      if (Array.isArray(s.states)) s.states = s.states.filter(keep);
      if (Array.isArray(s.notes)) s.notes = s.notes.filter(keep);
      changed = true;
    }
    if (
      Array.isArray(s.notes) &&
      s.notes.some(
        (x) =>
          SHARED.test(String(x)) ||
          DRAWING.test(String(x)) ||
          /\bdots?\b|real size|not to scale/i.test(String(x)),
      )
    ) {
      why.push(
        "`notes` sit under the panels one each; a note about the drawing (dots, arrows, size) or a shared fact goes in the title or lead",
      );
      delete s.notes;
      changed = true;
    }
  }
  return { out: changed ? s : spec, why };
}

/** The labels3 mend of one spec (identity unless the switch is on and the spec is particles). */
export function mendParticleLabels(spec: unknown): unknown {
  return inspect(spec).out;
}

/**
 * labels3 step 4: why a particles spec as the model sent it puts labels in literal slots (empty when
 * the switch is off). ParticlesSchema refuses on these, and the diagram-spec call is re-asked once
 * with them; whatever is left after the retry is mended (mendParticleLabels), never drawn literally.
 */
export function particleLabelFaults(spec: unknown): string[] {
  return inspect(spec).why;
}
