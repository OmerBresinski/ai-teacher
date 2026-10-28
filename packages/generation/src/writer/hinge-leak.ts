// TEACH-247 part bp: a hinge whose right option alone repeats a question word.
// The rule is the scorecard's "leaks" metric (scratchpad/tools/scorecard/score.ts), kept word for
// word: STOP, words and stems below are identical to score.ts's, and
// scratchpad/tools/scorecard/leak-parity.ts checks the two agree on every saved option set.
// No imports, so the scorecard can copy or import it as it stands.

type S = Record<string, unknown>;

export const LEAK_STOP = new Set(
  "what which where when why how does do did the a an and or of to in on at for from with by is are was were be it its this that these those they them their there then than into onto about can could would should will your you pupils pupil".split(
    " ",
  ),
);
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
/** A text's content words (4 letters or more, stop words out), each by its first 5 letters. */
export const leakStems = (s: string) =>
  new Set(
    words(s)
      .filter((w) => w.length >= 4 && !LEAK_STOP.has(w))
      .map((w) => w.slice(0, 5)),
  );

/**
 * The question's stems that the right option shares and no wrong option does: a lexical clue that
 * lets a pupil match the word instead of knowing the answer. Empty when there is no leak.
 */
export function leakedStems(question: string, right: string, wrong: readonly string[]): string[] {
  const rs = leakStems(right);
  const ds = new Set(wrong.flatMap((o) => [...leakStems(o)]));
  return [...leakStems(question)].filter((x) => rs.has(x) && !ds.has(x));
}

const textOf = (o: unknown) =>
  o && typeof o === "object" ? String((o as S).text ?? "") : String(o ?? "");

/** The first word of `text` whose stem is `stem` (as written, for the fault line). */
const wordFor = (text: string, stem: string) =>
  words(text).find((w) => w.length >= 4 && !LEAK_STOP.has(w) && w.slice(0, 5) === stem) ?? stem;

/**
 * A hinge's leak fault (`leak:` kind), or none. The right option is `correct` (counted from 1);
 * without it, the one option with no `why`. The question is the stem, or the heading when the slide
 * has no stem. The line names the slots the repair may change and the one it keeps.
 */
export function hingeLeakFaults(slide: S | undefined): string[] {
  if (slide?.template !== "hinge" || !Array.isArray(slide.options)) return [];
  const opts = slide.options as unknown[];
  if (opts.length < 2) return [];
  const c = Number(slide.correct);
  let k = Number.isInteger(c) && c >= 1 && c <= opts.length ? c - 1 : -1;
  if (k < 0) {
    const keyless = opts.flatMap((o, i) =>
      o && typeof o === "object" && (o as S).why == null ? [i] : [],
    );
    if (keyless.length !== 1) return [];
    k = keyless[0] ?? -1;
  }
  const slot = typeof slide.stem === "string" && slide.stem.trim() ? "stem" : "heading";
  const question = String(slide[slot] ?? "");
  const right = textOf(opts[k]);
  const leaked = leakedStems(question, right, opts.filter((_, i) => i !== k).map(textOf));
  if (!leaked.length) return [];
  const pairs = leaked
    .map((x) => {
      const q = wordFor(question, x);
      const r = wordFor(right, x);
      return q === r ? `"${q}"` : `"${q}" (as "${r}")`;
    })
    .join(" and ");
  const others = opts.flatMap((_, i) => (i === k ? [] : [`options[${i}]`])).join(", ");
  const [it, word, gives] =
    leaked.length > 1
      ? ["them", "those words", "the words give"]
      : ["it", "that word", "the word gives"];
  return [
    `leak: options[${k}], the answer, is the only option that repeats the ${slot}'s ${pairs}, so ${gives} the answer away. Keep options[${k}] word for word. Reword the ${slot} without ${word}, or reword a wrong option (${others}) to use ${it} too while it keeps the misconception it tests.`,
  ];
}
