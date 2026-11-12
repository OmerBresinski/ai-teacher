/*
 * The slide's stacked fractions in exported runs (REVIEW-web #2). The screen, Present and print
 * stack every fraction `findFractions` finds (`text/serialize.ts`); the export finds the same
 * spans with the same finder over the same text, so the same fractions are marked.
 *
 * pptxgenjs (4.0.1) writes no equation (OMML) and no stacked text, so PowerPoint gets the nearest
 * native form: the numerator raised (superscript) and the denominator lowered (subscript) around
 * the slash, "³/₄". It stays live text: it copies, searches and edits as "3/4". A bracketed side
 * keeps its brackets (inline, "(x + 2)/3" would misread without them), where the screen hides them
 * in the stack, and a mixed number keeps its plain space where the screen draws it narrower.
 */
import { findFractions } from "../text/fractions";
import type { Run, RunParagraph } from "./runs";

/** `run` cut at the given text offsets (relative to the run), each piece with the run's marks. */
function cut(run: Run, at: number[]): Run[] {
  const out: Run[] = [];
  let from = 0;
  for (const to of [...at, run.text.length]) {
    if (to > from) out.push({ ...run, text: run.text.slice(from, to) });
    from = Math.max(from, to);
  }
  return out;
}

/**
 * `paragraphs` with each fraction's numerator and denominator runs marked `frac`. A paragraph and
 * the soft lines after it are one text to the finder (joined by "\n"), as the screen reads a
 * paragraph with its hard breaks. `maths`: the box holds maths (`mathsElement`).
 */
export function withFractionRuns(paragraphs: RunParagraph[], maths = false): RunParagraph[] {
  const out: RunParagraph[] = [];
  let i = 0;
  while (i < paragraphs.length) {
    let j = i + 1;
    while (j < paragraphs.length && paragraphs[j]?.soft) j++;
    const group = paragraphs.slice(i, j);
    const text = group.map((p) => p.runs.map((r) => r.text).join("")).join("\n");
    const found = findFractions(text, { maths });
    if (found.length === 0) out.push(...group);
    else {
      const role = (k: number): Run["frac"] => {
        const f = found.find((x) => k >= x.start && k < x.end);
        return !f ? undefined : k < f.slash ? "num" : k > f.slash ? "den" : undefined;
      };
      const edges = found.flatMap((f) => [f.start, f.slash, f.slash + 1, f.end]);
      let base = 0;
      for (const p of group) {
        const runs: Run[] = [];
        for (const r of p.runs) {
          const at = edges.filter((e) => e > base && e < base + r.text.length).map((e) => e - base);
          for (const piece of cut(
            r,
            [...new Set(at)].sort((a, b) => a - b),
          )) {
            const frac = role(base);
            runs.push(frac ? { ...piece, frac } : piece);
            base += piece.text.length;
          }
        }
        out.push({ ...p, runs });
        base += 1; // the "\n" between soft lines
      }
    }
    i = j;
  }
  return out;
}
