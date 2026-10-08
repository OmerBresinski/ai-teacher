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
export type GasRule = "most" | "least";
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

/** The impossible values each slide states (texts[i] = slide i's words). Tolerance 5%. */
export function gasFaults(texts: readonly string[], rule: GasRule = "least"): GasHit[] {
  const lim = gasMax(texts, rule);
  const out: GasHit[] = [];
  texts.forEach((t, i) => {
    const vols = [...t.matchAll(VOL)].map((m) => Number(m[1]));
    const faults: string[] = [];
    const neg = [...t.matchAll(MASS)].map((m) => Number(m[1])).filter((x) => x < 0);
    if (vols.some((v) => v < 0) || neg.length)
      faults.push("a negative gas volume or mass cannot be measured");
    for (const m of t.matchAll(SOLID_CM3))
      faults.push(`${m[2]} is a solid: give its mass in g, not ${m[1]} cm³`);
    const over = lim ? [...new Set(vols.filter((v) => v > lim.vmax * 1.05))] : [];
    if (lim && over.length)
      faults.push(
        `${over.map((v) => `${v} cm³`).join(", ")} of gas is more than ${lim.why} can give (at most ${Math.floor(lim.vmax)} cm³ at room temperature); rescale the data so every volume is at most ${Math.floor(lim.vmax)} cm³, keeping the pattern`,
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
