/*
 * Round R: a diagram's labels and values must agree with the text beside it. Code, no model.
 * Round Q's y6 fault was a teaching slide's bar model (one ratio, one total) placed under a check
 * slide's questions on a different ratio and total. Two structural signals, silent when unsure:
 *
 * - ratio: the diagram states a ratio (in its words, or a two-or-more-bar bar model of equal
 *   parts) and the text states ratios, but none of the text's ratios is proportional to it;
 * - numbers: the diagram's words carry two or more numbers and the text carries none of them.
 *
 * Only the words drawn on the diagram are read (titles, labels, totals); its alt text and its
 * plotted values (axes, positions) are not, since an axis tick need not be in the text.
 */

/** Keys of a diagram spec whose text is not drawn as words on it. */
const NOT_DRAWN = new Set(["kind", "alt"]);

const NUMBER = /\d+(?:\.\d+)?/g;
const RATIO = /(\d+(?:\.\d+)?)(?:\s*:\s*(\d+(?:\.\d+)?))+/g;

/** Every drawn string in a diagram spec (titles, labels, totals), its alt text left out. */
export function diagramWords(spec: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown, key?: string) => {
    if (key && NOT_DRAWN.has(key)) return;
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) for (const x of v) walk(x);
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, k);
  };
  walk(spec);
  return out;
}

function numbersIn(text: string): Set<number> {
  return new Set((text.match(NUMBER) ?? []).map(Number));
}

/** The ratios a text states ("2 : 3", "1:4:5"), each as its terms. */
export function ratiosIn(text: string): number[][] {
  const out: number[][] = [];
  for (const m of text.matchAll(RATIO)) {
    const terms = m[0].split(":").map((t) => Number(t.trim()));
    if (terms.length >= 2 && terms.every((t) => Number.isFinite(t) && t > 0)) out.push(terms);
  }
  return out;
}

/** A bar model's ratio of equal parts (2 bars of 2 and 3 parts: 2 : 3), when its parts are equal. */
function barModelRatio(spec: unknown): number[] | undefined {
  const s = spec as { kind?: unknown; bars?: unknown };
  if (s?.kind !== "bar-model" || !Array.isArray(s.bars) || s.bars.length < 2) return undefined;
  const counts: number[] = [];
  const values = new Set<number>();
  for (const bar of s.bars as { parts?: { value?: number }[] }[]) {
    if (!Array.isArray(bar.parts) || bar.parts.length === 0) return undefined;
    counts.push(bar.parts.length);
    for (const p of bar.parts) if (typeof p.value === "number") values.add(p.value);
  }
  return values.size <= 1 ? counts : undefined;
}

function proportional(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const [a0, b0] = [a[0] as number, b[0] as number];
  return a.every((x, i) => Math.abs(x * b0 - (b[i] as number) * a0) < 1e-9);
}

/**
 * Why a diagram disagrees with the text beside it, in words the writer can act on; an empty list
 * when it agrees or the check cannot tell.
 */
export function diagramDisagreements(spec: unknown, text: string): string[] {
  const words = diagramWords(spec).join(" \n ");
  const problems: string[] = [];
  const textRatios = ratiosIn(text);
  const drawnRatios = [...ratiosIn(words)];
  const bars = barModelRatio(spec);
  if (bars) drawnRatios.push(bars);
  if (textRatios.length > 0) {
    const off = drawnRatios.find((d) => !textRatios.some((t) => proportional(d, t)));
    if (off)
      problems.push(
        `the diagram shows the ratio ${off.join(" : ")} but the text states ${[
          ...new Set(textRatios.map((t) => t.join(" : "))),
        ].join(", ")}`,
      );
  }
  const drawn = numbersIn(words);
  const stated = numbersIn(text);
  // DIAGRAM-AUDIT #3: a table or timeline carries data the text summarises (Freud's stage ages),
  // so only drawings whose numbers ARE the point (bars, number lines, graphs) must repeat them.
  const kind = (spec as { kind?: unknown } | null)?.kind;
  const numbersArePoint = kind === "bar-model" || kind === "number-line" || kind === "line-graph";
  if (numbersArePoint && drawn.size >= 2 && ![...drawn].some((n) => stated.has(n)))
    problems.push(
      `the diagram's numbers (${[...drawn].join(", ")}) appear nowhere in the slide's text`,
    );
  return problems;
}
