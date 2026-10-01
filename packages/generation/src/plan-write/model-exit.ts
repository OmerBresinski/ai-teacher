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
 * The exit items: one call, the checks, one re-ask for the items that failed, and the order.
 * `call` throwing on the first call is the caller's to catch (it falls back); a failed re-ask only
 * drops the items it was for. Undefined when no item survives.
 */
export async function modelExitItems(
  input: Omit<ExitItemsInput, "count" | "redo">,
  call: (input: ExitItemsInput) => Promise<ExitItemsOutput>,
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
  const review = (raws: readonly Raw[]) => {
    const redo: NonNullable<ExitItemsInput["redo"]> = [];
    for (const raw of raws) {
      const v = reviewItem(raw, input.objectives.length, input.asked, kept, kept.length);
      if ("item" in v) {
        kept.push(v.item);
        if (v.fixed) report.sumsFixed += 1;
      } else {
        report.rejected.push({ question: raw.question, problem: v.problem });
        redo.push({
          objective: raw.objective,
          form: raw.form,
          question: raw.question,
          problem: v.problem,
        });
      }
    }
    return redo;
  };

  const first = await call({ ...input, count });
  report.written = first.items.length;
  const redo = review(first.items.slice(0, count + 1));
  if (redo.length > 0) {
    report.reasked = redo.length;
    try {
      const again = await call({ ...input, count, redo });
      const allowed = redo.map((r) => r.objective);
      const retry = again.items.filter((r) => {
        const at = allowed.indexOf(r.objective);
        if (at === -1) return false;
        allowed.splice(at, 1);
        return true;
      });
      const before = kept.length;
      review(retry);
      report.dropped = redo.length - (kept.length - before);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      report.dropped = redo.length;
    }
  }
  const items = ordered(kept, count);
  report.kept = items.length;
  return items.length > 0 ? { items, report } : undefined;
}
