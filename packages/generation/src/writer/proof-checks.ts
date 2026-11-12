/*
 * Counts the v5.2-gold proof reads off a written lesson (scratchpad/tuning/v5.2-gold BUILDER B7;
 * METHOD rule 8: checks in code, logged only, never a gate). Pure: the writer's raw output in,
 * numbers out; `runWriter` logs them as one `proof-checks` event per lesson, on every pack.
 */

type S = Record<string, unknown>;

/** Lower case, letters, digits and the maths signs a row's line uses; nothing else. */
const flat = (t: unknown) =>
  String(t ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9/÷×+−\-=.]/g, "")
    .replace(/\.$/, "");

/** The two sides of a row's line at its last "=" (undefined without one). */
function sides(eq: unknown): [string, string] | undefined {
  const t = String(eq ?? "");
  const at = t.lastIndexOf("=");
  return at < 0 ? undefined : [flat(t.slice(0, at)), flat(t.slice(at + 1))];
}

/**
 * Worked rows that only restate: a row whose line's left side is the heading's problem and whose
 * right side is the previous row's result ("1/3 of 21 = 7" after "21 ÷ 3 = 7" under "Find 1/3 of 21.").
 */
export function workedRestates(slide: S): number {
  if (slide.template !== "worked" || !Array.isArray(slide.lines)) return 0;
  const heading = flat(slide.heading);
  const rows = slide.lines as S[];
  let n = 0;
  for (let i = 1; i < rows.length; i++) {
    const now = sides(rows[i]?.eq);
    const before = sides(rows[i - 1]?.eq);
    if (!now || !before || !now[0]) continue;
    if (heading.includes(now[0]) && now[1] === before[1]) n++;
  }
  return n;
}

export type ProofChecks = {
  /** Slides the flow planned against the brief's range. */
  flowCount: { planned: number; min: number; max: number };
  /** Worked rows that only restate the answer, over every worked slide. */
  workedRestate: number;
  /** The exit ticket's questions against the lesson's objectives (null without an exit ticket on the slides). */
  exitObjectives: { questions: number; objectives: number } | null;
};

export function proofChecks(
  out: { flow?: unknown[] | undefined; slides?: S[] | undefined },
  range: { min: number; max: number },
  objectives: number,
): ProofChecks {
  const slides = out.slides ?? [];
  const exit = slides.find((s) => s.template === "exit-ticket");
  return {
    flowCount: { planned: out.flow?.length ?? 0, min: range.min, max: range.max },
    workedRestate: slides.reduce((n, s) => n + workedRestates(s), 0),
    exitObjectives: exit
      ? { questions: Array.isArray(exit.items) ? exit.items.length : 0, objectives }
      : null,
  };
}
