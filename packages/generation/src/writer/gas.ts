// faults-3-6-8 #8 (gas8 code arm): physically impossible practical data. R4 y11 sets 0.040 g of
// magnesium (at most 40 cm³ of hydrogen at room temperature) and then claims 48, 54 and 72 cm³.
// The check reads the whole lesson. Rule "least" (the switch's, as the root cause measured it): the
// smallest stated mass of each reactant (the method's) limits every gas volume the lesson claims.
// Rule "most" (certain only, for comparison): the largest stated mass of each
// reactant limits every gas volume the lesson claims (24 dm³/mol at RTP), so a flag is certain even
// when a lesson compares 0.04 g and 0.08 g and a sentence does not say which; it misses R4 itself
// (0.040 g method, 0.08 g in a later table). A gas
// volume above the most the stated reactant can give, a negative volume or mass, or a solid measured in cm³ is a fault on the slide that says it.
// The slide goes to the existing repair once; if the fault is still there, rescaleGas makes a
// text-safe version (every claimed volume on the slide scaled under the maximum, ratios kept).

/** Moles of gas per mole of reactant, and molar mass (g/mol): metal + acid -> H2, carbonate -> CO2. */
const REACTANTS: Record<string, { M: number; per: number }> = {
  magnesium: { M: 24.3, per: 1 },
  zinc: { M: 65.4, per: 1 },
  iron: { M: 55.8, per: 1 },
  calcium: { M: 40.1, per: 1 },
  aluminium: { M: 27, per: 1.5 },
  "calcium carbonate": { M: 100.1, per: 1 },
  "marble chips": { M: 100.1, per: 1 },
  marble: { M: 100.1, per: 1 },
};
const RTP_CM3 = 24000;
const NUM = String.raw`(-?\d+(?:\.\d+)?)`;
const MASS = new RegExp(
  String.raw`${NUM}\s*g\s+(?:of\s+)?(calcium carbonate|marble chips|marble|magnesium|zinc|iron|calcium|aluminium)`,
  "gi",
);
/** A claimed gas volume: "48 cm³ of hydrogen", "54 cm³ of gas", "72 cm³ in its first 60 s". */
const VOL = new RegExp(
  String.raw`${NUM}\s*cm(?:³|3|\^3)\s*(?:of\s+(?:hydrogen|gas|carbon dioxide|CO2|H2)\b|in\s+(?:its|the)\s+first\b|(?:of\s+)?(?:hydrogen|gas)\s+(?:is\s+)?(?:collected|produced|given off|made))`,
  "gi",
);
const SOLID_CM3 = new RegExp(
  String.raw`${NUM}\s*cm(?:³|3|\^3)\s*of\s+(magnesium|zinc|iron|marble|calcium carbonate)\b`,
  "gi",
);

export type GasHit = { slide: number; fault: string; volumes: number[]; vmax?: number };

/** The most gas (cm³ at RTP) the lesson's stated reactants allow, or undefined when none is stated. */
export type GasRule = "tied" | "most" | "least";
export function gasMax(
  texts: readonly string[],
  rule: GasRule = "least",
): { vmax: number; why: string } | undefined {
  const least = new Map<string, number>();
  const pick = rule === "most" ? Math.max : Math.min;
  const start = rule === "most" ? 0 : Number.POSITIVE_INFINITY;
  for (const t of texts)
    for (const m of t.matchAll(MASS)) {
      const g = Number(m[1]);
      const r = String(m[2]).toLowerCase();
      if (g > 0) least.set(r, pick(least.get(r) ?? start, g));
    }
  let best: { vmax: number; why: string } | undefined;
  for (const [r, g] of least) {
    const k = REACTANTS[r] as { M: number; per: number };
    const v = (g / k.M) * k.per * RTP_CM3;
    if (!best || v > best.vmax) best = { vmax: v, why: `${g} g of ${r}` };
  }
  return best;
}

/** Clauses of a slide's text (a decimal point is not a break). */
const clauses = (t: string) => t.split(/(?<!\d)\.(?!\d)|[;!?\n|]/);
/** A clause about every test in the lesson ("Both tests reach 60 cm³", "each flask"). */
const ALL_TESTS = /\b(both|each|all|every)\b/i;
/** The most gas `g` grams of reactant `r` can give (cm³ at RTP). */
const gasOf = (r: string, g: number) => {
  const k = REACTANTS[r] as { M: number; per: number };
  return (g / k.M) * k.per * RTP_CM3;
};
/** Stated masses (g > 0) per reactant in some texts. */
function massesIn(texts: readonly string[]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const t of texts)
    for (const x of t.matchAll(MASS)) {
      const g = Number(x[1]);
      const r = String(x[2]).toLowerCase();
      if (g > 0) m.set(r, [...(m.get(r) ?? []), g]);
    }
  // A second mass is often bare ("0.04 g magnesium at 20°C, then 0.08 g at 30°C"): on a text that
  // names a reactant's mass, every other "N g" counts as that reactant's too (follow-up 9 Oct: six of
  // the first rule's flags missed the second mass this way).
  for (const t of texts) {
    const named = [...t.matchAll(MASS)].map((x) => String(x[2]).toLowerCase());
    const r = named[0];
    if (!r || new Set(named).size > 1) continue;
    for (const x of t.matchAll(BARE_MASS)) {
      const g = Number(x[1]);
      if (g > 0 && !(m.get(r) ?? []).includes(g)) m.set(r, [...(m.get(r) ?? []), g]);
    }
  }
  return m;
}
/** A bare mass in grams: "0.08 g", not "g/dm³", "g of salt" or a word starting with g. */
const BARE_MASS =
  /(\d+(?:\.\d+)?)\s*g\b(?!\s*\/)(?!\s+of\s+(?!magnesium|zinc|iron|calcium|aluminium|marble))/g;
/** The highest gas limit over reactants, with each reactant's mass picked by `pick`. */
function limitOf(
  m: Map<string, number[]>,
  pick: (gs: number[]) => number,
): { vmax: number; why: string } | undefined {
  let best: { vmax: number; why: string } | undefined;
  for (const [r, gs] of m) {
    const g = pick(gs);
    const v = gasOf(r, g);
    if (!best || v > best.vmax) best = { vmax: v, why: `${g} g of ${r}` };
  }
  return best;
}

/**
 * The limit a gas-volume clause on slide `i` is held to, or undefined when no stated mass is tied to
 * it. Rule "tied" (the switch's, follow-up 9 Oct): a clause about every test ("both", "each") takes
 * the lesson's smallest mass; else the masses on the same slide (their largest); else the lesson's
 * one mass when it states only one per reactant; else the lesson's largest mass, so a generic
 * "A reaction produces 48 cm³" in a lesson that compares 0.04 g and 0.08 g passes (0.08 g allows it). Rules "least" and "most"
 * are the lesson-wide smallest and largest mass (the first measurement, kept for comparison).
 */
function limitFor(
  texts: readonly string[],
  i: number,
  clause: string,
  rule: GasRule,
): { vmax: number; why: string } | undefined {
  const lesson = massesIn(texts);
  if (rule === "least") return limitOf(lesson, (gs) => Math.min(...gs));
  if (rule === "most") return limitOf(lesson, (gs) => Math.max(...gs));
  if (ALL_TESTS.test(clause)) return limitOf(lesson, (gs) => Math.min(...gs));
  const here = massesIn([texts[i] ?? ""]);
  if (here.size) return limitOf(here, (gs) => Math.max(...gs));
  const one = new Map([...lesson].filter(([, gs]) => new Set(gs).size === 1));
  if (one.size === lesson.size) return limitOf(one, (gs) => gs[0] as number);
  // Untied, several masses: held to the largest, so only a volume no stated setup can give is flagged.
  return limitOf(lesson, (gs) => Math.max(...gs));
}

/** The impossible values each slide states (texts[i] = slide i's words). Tolerance 5%. */
export function gasFaults(texts: readonly string[], rule: GasRule = "tied"): GasHit[] {
  const out: GasHit[] = [];
  texts.forEach((t, i) => {
    const vols = [...t.matchAll(VOL)].map((m) => Number(m[1]));
    const faults: string[] = [];
    const neg = [...t.matchAll(MASS)].map((m) => Number(m[1])).filter((x) => x < 0);
    if (vols.some((v) => v < 0) || neg.length)
      faults.push("a negative gas volume or mass cannot be measured");
    for (const m of t.matchAll(SOLID_CM3))
      faults.push(`${m[2]} is a solid: give its mass in g, not ${m[1]} cm³`);
    let lim: { vmax: number; why: string } | undefined;
    const over = new Set<number>();
    for (const c of clauses(t))
      for (const m of c.matchAll(VOL)) {
        const l = limitFor(texts, i, c, rule);
        const v = Number(m[1]);
        if (l && v > l.vmax * 1.05) {
          over.add(v);
          if (!lim || l.vmax < lim.vmax) lim = l;
        }
      }
    if (lim && over.size)
      faults.push(
        `${[...over].map((v) => `${v} cm³`).join(", ")} of gas is more than ${lim.why} can give (at most ${Math.floor(lim.vmax)} cm³ at room temperature); rescale the data so every volume is at most ${Math.floor(lim.vmax)} cm³, keeping the pattern`,
      );
    if (faults.length)
      out.push({
        slide: i,
        fault: `fact: ${faults.join("; ")}`,
        volumes: vols,
        ...(lim ? { vmax: lim.vmax } : {}),
      });
  });
  return out;
}

/**
 * The text-safe version of a slide: every claimed gas volume scaled by one factor so the largest is
 * 90% of the maximum (whole numbers, ratios kept), and negative volumes made positive. Strings only;
 * the slide's structure is untouched.
 */
export function rescaleGas<T>(slide: T, volumes: readonly number[], vmax: number | undefined): T {
  const top = Math.max(0, ...volumes.map(Math.abs));
  const f = vmax && top > vmax ? (vmax * 0.9) / top : 1;
  const fix = (s: string) =>
    s.replace(VOL, (all, n: string) => {
      const v = Math.abs(Number(n)) * f;
      const shown = v >= 10 ? String(Math.round(v)) : v.toFixed(1);
      return all.replace(n, shown);
    });
  const walk = (v: unknown): unknown =>
    typeof v === "string"
      ? fix(v)
      : Array.isArray(v)
        ? v.map(walk)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
          : v;
  return walk(slide) as T;
}
