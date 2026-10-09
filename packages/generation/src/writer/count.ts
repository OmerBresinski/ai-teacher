import { CHECK_TEMPLATES, coverage, type FlowEntry } from "./notes";

/*
 * The teacher's exact slide count (ADR 0036), held in code after the writer answers. The strict
 * schema asks for exactly n; a provider that returns one more or one fewer is handled here, never
 * by failing the job and never by shipping an overshoot silently:
 * - over: each extra slide is trimmed in code, no model call: the slide whose loss leaves the
 *   objectives most covered, a teaching slide before a check slide, then the one with fewest words;
 * - one short: the deck ships as written, with a warning (K3 still fails anything shorter, which
 *   is a cut stream, not a count slip).
 */

type S = Record<string, unknown>;
export type WriterOut = { flow?: FlowEntry[]; slides?: S[]; [k: string]: unknown };
export type CountFit = {
  out: WriterOut;
  /** Deck slide numbers (from 1, title first) removed, in the original numbering. */
  trimmed: number[];
  /** Slides still missing against the count (0 or 1). */
  short: number;
};

const wordCount = (s: S) => JSON.stringify(s).split(/\s+/).length;

/** The writer's output at the teacher's count `n` (title and objectives included). */
export function fitCount(out: WriterOut, n: number, objectives: number): CountFit {
  let slides = [...(out.slides ?? [])];
  let ids = slides.map((_, j) => j + 3);
  let flow = (out.flow ?? []).map((f) => ({ ...f }));
  const trimmed: number[] = [];
  const tplAt = (sl: S[]) => (k: number) => sl[k - 3]?.template as string | undefined;
  while (slides.length + 2 > n && slides.length > 0) {
    const before = coverage(flow, objectives, tplAt(slides)).missing.length;
    // Each candidate scored by coverage lost, then check slides last, then fewest words.
    const score = (j: number): [number, number, number] => {
      const after = coverage(
        renumber(flow, j + 3),
        objectives,
        tplAt(slides.filter((_, x) => x !== j)),
      ).missing.length;
      const s = slides[j] as S;
      return [after - before, CHECK_TEMPLATES.has(String(s.template)) ? 1 : 0, wordCount(s)];
    };
    const scored = slides.map((_, j) => ({ j, s: score(j) }));
    scored.sort((a, b) => a.s[0] - b.s[0] || a.s[1] - b.s[1] || a.s[2] - b.s[2]);
    const j = (scored[0] as { j: number }).j;
    trimmed.push(ids[j] as number);
    flow = renumber(flow, j + 3);
    slides = slides.filter((_, x) => x !== j);
    ids = ids.filter((_, x) => x !== j);
  }
  return {
    out: { ...out, slides, flow },
    trimmed,
    short: Math.max(0, n - (slides.length + 2)),
  };
}

/** The flow without deck slide `k`, the later slides numbered down by one. */
function renumber(flow: FlowEntry[], k: number): FlowEntry[] {
  return flow
    .filter((f) => f.slide !== k)
    .map((f) => (f.slide > k ? { ...f, slide: f.slide - 1 } : f));
}
