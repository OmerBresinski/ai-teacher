import type { ExitItemsInput, ExitItemsOutput } from "../prompts/exit-items";
import { SIMILARITY_MAX, similarity } from "./fresh-exit";
import { recomputeSums } from "./gates";

/*
 * Round Q: the exit ticket written by a model (`prompts/exit-items.ts`), then checked in code.
 * Each item must be new (under `SIMILARITY_MAX` against every in-lesson question and every item
 * kept before it), name an objective in the list, have a multiple-choice key that is one option
 * and not a wrong one, and state its sums correctly. A wrong sum is put right in place when its
 * result appears once in the answer; anything else is asked again once, then the item is dropped.
 * The caller falls back to Round P's code-built items when the call fails or nothing survives.
 */

export type ExitItemForm = ExitItemsOutput["items"][number]["form"];

export type ModelExitItem = {
  /** The question as printed: a multiple-choice item carries its lettered options. */
  question: string;
  answer: string;
  /** 0-based index into the lesson's objectives. */
  objective: number;
  form: ExitItemForm;
  /** The highest similarity to any in-lesson question. */
  similarity: number;
};

export type ModelExitReport = {
  written: number;
  rejected: { question: string; problem: string }[];
  sumsFixed: number;
  reasked: number;
  dropped: number;
  kept: number;
};

/** How many items to ask for: one per objective, 3 to 4 in all. */
export const exitItemCount = (objectives: number) => Math.min(4, Math.max(3, objectives));

const LETTERS = ["A", "B", "C", "D"];

/** The options in a fixed order that moves the key between items, lettered on one line. */
function lettered(
  stem: string,
  answer: string,
  wrong: readonly string[],
  at: number,
): { question: string; answer: string } {
  const options = [...wrong];
  const pos = at % (wrong.length + 1);
  options.splice(pos, 0, answer);
  const line = options.map((o, i) => `(${LETTERS[i]}) ${o.replace(/[.]$/, "")}`).join(" ");
  return { question: `${stem} ${line}`, answer: `(${LETTERS[pos]}) ${answer.replace(/[.]$/, "")}` };
}

const same = (a: string, b: string) =>
  a.trim().toLowerCase().replace(/[.]$/, "") === b.trim().toLowerCase().replace(/[.]$/, "");

type Raw = ExitItemsOutput["items"][number];
type Verdict = { item: ModelExitItem; fixed: boolean } | { problem: string };

/** One raw item checked against the lesson's questions and the items already kept. */
export function reviewItem(
  raw: Raw,
  objectives: number,
  asked: readonly string[],
  kept: readonly ModelExitItem[],
  at: number,
): Verdict {
  const objective = raw.objective - 1;
  if (!Number.isInteger(objective) || objective < 0 || objective >= objectives)
    return { problem: `objective ${raw.objective} is not in the list` };
  let sim = 0;
  let closest = "";
  for (const a of asked) {
    const s = similarity(raw.question, a);
    if (s > sim) [sim, closest] = [s, a];
  }
  if (sim >= SIMILARITY_MAX)
    return { problem: `too like the lesson's question "${closest}"; ask something new` };
  const twin = kept.find((k) => similarity(raw.question, k.question) >= SIMILARITY_MAX);
  if (twin) return { problem: `too like another exit item, "${twin.question}"` };
  const mcq = raw.form === "multiple-choice";
  const wrong = mcq ? raw.wrongOptions.filter((w) => w.trim()) : [];
  if (mcq && (wrong.length < 2 || wrong.length > 3))
    return { problem: "a multiple-choice item needs two or three wrong options" };
  if (mcq && wrong.some((w) => same(w, raw.answer)))
    return { problem: "the answer is also given as a wrong option" };
  const sums = recomputeSums(raw.answer);
  if (sums.unfixed.length > 0)
    return { problem: `the working is wrong: ${sums.unfixed.join("; ")}` };
  const answer = sums.text.trim();
  const printed = mcq
    ? lettered(raw.question.trim(), answer, wrong, at + objective)
    : { question: raw.question.trim(), answer };
  return {
    item: { ...printed, objective, form: raw.form, similarity: sim },
    fixed: sums.fixed > 0,
  };
}

/** Coverage first: each objective's first item in objective order, then the rest, capped. */
export function ordered(items: readonly ModelExitItem[], max: number): ModelExitItem[] {
  const firsts: ModelExitItem[] = [];
  const rest: ModelExitItem[] = [];
  for (const i of [...items].sort((a, b) => a.objective - b.objective)) {
    (firsts.some((f) => f.objective === i.objective) ? rest : firsts).push(i);
  }
  return [...firsts, ...rest].slice(0, max);
}

/**
 * Code checks beyond the item's own: `fits` says whether a set of items fits the closing slide
 * (when one does not, the longest item is the one asked again, so a long first item cannot crowd
 * out the rest), `untaught` names the terms a question asks about that no teaching slide shows. An item
 * failing either is asked again, never dropped silently (round S, S1 y6: a long multiple-choice
 * item filled the slide and the other two were trimmed off it, leaving one).
 */
export type ExitItemChecks = {
  /** Whether these items, together, fit the closing slide. */
  fits?: (items: readonly ModelExitItem[]) => boolean;
  untaught?: (question: string) => string[];
};

const TOO_LONG =
  "it is too long to fit on the slide beside the other items; write it shorter: a question of at most 12 words and an answer of at most 12 words";

/** Re-asks after the first call: enough to give each objective an item and reach the count. */
export const EXIT_REASKS = 2;

/**
 * The exit items: one call, the checks, then up to `EXIT_REASKS` re-asks for the items that failed
 * and for any objective still without an item or a set still short of three, and the order.
 * `call` throwing on the first call is the caller's to catch (it falls back); a failed re-ask only
 * leaves the items it was for unwritten. Undefined when no item survives.
 */
export async function modelExitItems(
  input: Omit<ExitItemsInput, "count" | "redo">,
  call: (input: ExitItemsInput) => Promise<ExitItemsOutput>,
  checks: ExitItemChecks = {},
): Promise<{ items: ModelExitItem[]; report: ModelExitReport } | undefined> {
  const count = exitItemCount(input.objectives.length);
  const report: ModelExitReport = {
    written: 0,
    rejected: [],
    sumsFixed: 0,
    reasked: 0,
    dropped: 0,
    kept: 0,
  };
  const kept: ModelExitItem[] = [];
  const rawOf = new Map<ModelExitItem, Raw>();
  type Redo = NonNullable<ExitItemsInput["redo"]>[number];
  const review = (raws: readonly Raw[]) => {
    const redo: Redo[] = [];
    for (const raw of raws) {
      const v = reviewItem(raw, input.objectives.length, input.asked, kept, kept.length);
      let problem = "problem" in v ? v.problem : undefined;
      if (!problem && "item" in v) {
        const terms = checks.untaught?.(v.item.question) ?? [];
        if (terms.length > 0)
          problem = `it asks about ${terms.map((t) => `"${t}"`).join(", ")}, which no teaching slide shows; ask only about what the slides teach`;
        else if (checks.fits && !checks.fits([...kept, v.item])) {
          const size = (i: ModelExitItem) => i.question.length + i.answer.length;
          const longest = [...kept].sort((a, b) => size(b) - size(a))[0];
          const rest = kept.filter((k) => k !== longest);
          if (longest && size(longest) > size(v.item) && checks.fits([...rest, v.item])) {
            // The longest kept item makes way and is asked again shorter.
            kept.splice(kept.indexOf(longest), 1);
            const was = rawOf.get(longest);
            report.rejected.push({ question: longest.question, problem: TOO_LONG });
            redo.push({
              objective: longest.objective + 1,
              form: longest.form,
              question: was?.question ?? longest.question,
              problem: TOO_LONG,
            });
          } else problem = TOO_LONG;
        }
      }
      if (!problem && "item" in v) {
        kept.push(v.item);
        rawOf.set(v.item, raw);
        if (v.fixed) report.sumsFixed += 1;
        continue;
      }
      report.rejected.push({ question: raw.question, problem: problem ?? "" });
      redo.push({
        objective: raw.objective,
        form: raw.form,
        question: raw.question,
        problem: problem ?? "",
      });
    }
    return redo;
  };
  /** Each objective with no item kept, then a filler on the first objective, up to three in all. */
  const missing = (failed: readonly Redo[]): Redo[] => {
    const out: Redo[] = [];
    const has = (o: number) =>
      kept.some((k) => k.objective === o - 1) || failed.some((f) => f.objective === o);
    for (let o = 1; o <= input.objectives.length; o++) {
      if (!has(o))
        out.push({
          objective: o,
          form: "explain",
          question: "",
          problem: "this objective has no exit item yet; write one",
        });
    }
    while (kept.length + failed.length + out.length < Math.min(3, count))
      out.push({
        objective: 1 + ((kept.length + failed.length + out.length) % input.objectives.length),
        form: "apply",
        question: "",
        problem: "the exit ticket needs another item; write one on a case not yet asked",
      });
    return out;
  };

  const first = await call({ ...input, count });
  report.written = first.items.length;
  let redo = review(first.items.slice(0, count + 1));
  redo = [...redo, ...missing(redo)];
  for (let round = 0; round < EXIT_REASKS && redo.length > 0; round++) {
    report.reasked += redo.length;
    try {
      const again = await call({ ...input, count, redo });
      const allowed = redo.map((r) => r.objective);
      const retry = again.items.filter((r) => {
        const at = allowed.indexOf(r.objective);
        if (at === -1) return false;
        allowed.splice(at, 1);
        return true;
      });
      const failed = review(retry);
      // The ones the reply left out are still owed: asked again with their first problem.
      const left = redo.filter((r) => {
        const at = allowed.indexOf(r.objective);
        if (at === -1) return false;
        allowed.splice(at, 1);
        return true;
      });
      redo = [...failed, ...left];
      redo = [...redo, ...missing(redo)];
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      break;
    }
  }
  report.dropped = redo.filter((r) => r.question !== "").length;
  const items = ordered(kept, count);
  report.kept = items.length;
  return items.length > 0 ? { items, report } : undefined;
}
