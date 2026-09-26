import type { QUESTION_TIERS, QUESTION_USES } from "@tj/domain/documents";
import type { QuestionDemand, QuestionForm } from "./prompts/plan-facts-objective";

export type { QuestionDemand, QuestionForm } from "./prompts/plan-facts-objective";

/**
 * What one per-objective facts call (`plan-facts-objective`, lab branch TEACH-11) returns: the
 * item shapes of `planFactsShape` in `specs.ts` minus `objectiveRefs` (every item serves the one
 * objective the call was given). Declared structurally here so the merge, the outline step and
 * their fixtures do not depend on the prompt file landing first. `forms` (the ways a question can
 * be set) and `demand` (what it asks of the pupil) are the prompt's declarations
 * (`QUESTION_FORMS`, `QUESTION_DEMANDS` in `prompts/plan-facts-objective.ts`), read as optional
 * here so a facts list written before v9 still merges. The outline reads them structurally and
 * never infers either from a question's text or its distractors.
 */
export type ObjectiveFactsOutput = {
  keyIdeas: { statement: string; explanation: string; example: string; analogy?: string }[];
  misconceptions: { belief: string; correction: string }[];
  vocabulary: { term: string; definition: string }[];
  workedExamples: {
    problem: string;
    steps: string[];
    answer: string;
    misconceptionRef?: { type: "misconception"; index: number };
    /** The objectives the example serves, as the call declares them (v9); absent: the call's own. */
    objectiveRefs?: { type: "objective"; index: number }[] | undefined;
  }[];
  questions: {
    stem: string;
    answer: string;
    reasoning: string;
    tier: (typeof QUESTION_TIERS)[number];
    use: (typeof QUESTION_USES)[number];
    distractors?: { text: string; misconceptionRef?: { type: "misconception"; index: number } }[];
    forms?: QuestionForm[] | undefined;
    demand?: QuestionDemand | undefined;
    /**
     * The key ideas the question tests, by position in THIS output's `keyIdeas` (v11). Merged to
     * lesson positions; refs outside the call's list are dropped, and none left means absent.
     */
    keyIdeaRefs?: KeyIdeaOrdinal[] | undefined;
  }[];
};

/*
 * Merge the per-objective facts calls (`plan-facts-objective`) into one facts list of the shape the
 * monolithic `plan-facts` call returns, minus the outline: every item gains the `objectiveRefs`
 * ordinal of the objective whose call wrote it, misconception references are re-indexed into the
 * merged list, and what several calls wrote twice is kept once. The calls run blind to each other
 * (that is what makes them parallel), so duplication is handled here, never by the prompt.
 *
 * Two items are one item only when their COMPLETE payload is equal under a meaning-preserving
 * normalisation (`normaliseText`: case, whitespace, curly quotes, a closing full stop). The
 * earlier occurrence is kept and the later objective is added to its `objectiveRefs`, so coverage
 * is not lost. Two items that share a key (a vocabulary term, a misconception belief, a key idea
 * statement, a worked example problem, a question stem) but differ anywhere else are a
 * `conflict`: both are kept, in order, and the conflict is recorded in `duplicates.conflicts`
 * for the log and the bench. Code never picks a winner between two definitions.
 */

type Ordinal = { type: "objective"; index: number };
type MisconceptionOrdinal = { type: "misconception"; index: number };
type KeyIdeaOrdinal = { type: "keyIdea"; index: number };

type Output = ObjectiveFactsOutput;
type KeyIdea = Output["keyIdeas"][number] & { objectiveRefs: Ordinal[] };
type Misconception = Output["misconceptions"][number] & { objectiveRefs: Ordinal[] };
type Vocabulary = Output["vocabulary"][number] & { objectiveRefs: Ordinal[] };
type WorkedExample = Omit<
  Output["workedExamples"][number],
  "misconceptionRef" | "objectiveRefs"
> & {
  objectiveRefs: Ordinal[];
  misconceptionRef?: MisconceptionOrdinal | undefined;
};
type OutputDistractor = NonNullable<Output["questions"][number]["distractors"]>[number];
type Question = Omit<Output["questions"][number], "distractors" | "keyIdeaRefs"> & {
  objectiveRefs: Ordinal[];
  keyIdeaRefs?: KeyIdeaOrdinal[] | undefined;
  distractors: (Omit<OutputDistractor, "misconceptionRef"> & {
    misconceptionRef?: MisconceptionOrdinal | undefined;
  })[];
};

export const MERGE_LISTS = [
  "keyIdeas",
  "misconceptions",
  "vocabulary",
  "workedExamples",
  "questions",
] as const;
export type MergeList = (typeof MERGE_LISTS)[number];

/** Two items with the same key and a different payload: both kept, neither chosen. */
export type MergeConflict = {
  list: MergeList;
  /** The normalised key the two share (a term, a belief, a statement, a problem, a stem). */
  key: string;
  /** Indices in the merged list, in order of arrival. */
  indices: number[];
  /**
   * Per index, every objective whose call wrote that item (its `objectiveRefs`, in order): an
   * exact duplicate merged into it, before or after the conflict arose, is listed too.
   */
  objectives: number[][];
};

export type MergedObjectiveFacts = {
  keyIdeas: KeyIdea[];
  misconceptions: Misconception[];
  vocabulary: Vocabulary[];
  workedExamples: WorkedExample[];
  questions: Question[];
  /** What was dropped as an exact duplicate, by list, and what was kept twice as a conflict. */
  duplicates: {
    keyIdeas: number;
    misconceptions: number;
    vocabulary: number;
    workedExamples: number;
    questions: number;
    conflicts: MergeConflict[];
    /**
     * Audit A5: objectives (0-based) whose worked example uses the same numbers as one of the
     * same call's key-idea examples, so the next slide's example pre-solves it (Y7 ratio k4/x1).
     * Flagged, not changed.
     */
    exampleRepeats: number[];
  };
};

/** The numbers in a text, in order ("£40 in 3:2" → 40,3,2). */
const numbersOf = (text: string) => text.match(/\d+(?:\.\d+)?/g) ?? [];

/**
 * Whether one of a call's worked examples uses the same two or more numbers, in the same order,
 * as one of its key-idea examples: the same problem, worked twice.
 */
export function repeatsKeyIdeaExample(
  output: Pick<Output, "keyIdeas" | "workedExamples">,
): boolean {
  const examples = output.keyIdeas
    .map((k) => numbersOf(k.example ?? "").join(","))
    .filter((n) => n.split(",").length >= 2);
  return output.workedExamples.some((w) => {
    const n = numbersOf(w.problem).join(",");
    return (
      n.split(",").length >= 2 && examples.some((e) => e === n || e.includes(n) || n.includes(e))
    );
  });
}

/**
 * Meaning-preserving normalisation only: lower case, curly quotes and apostrophes straightened,
 * whitespace collapsed, one closing full stop dropped ("Ratio part." and "ratio part" are one
 * term). Signs, digits, decimal points and operators are kept: "Calculate -5 + 3" and
 * "Calculate 5 + 3" are two problems, "0.5" and "05" two answers.
 */
export function normaliseText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, "")
    .trim();
}

/** The whole payload, normalised field by field, as one comparable string. */
function normalisePayload(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(normaliseText(value));
  if (Array.isArray(value)) return `[${value.map(normalisePayload).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${normalisePayload(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function ordinal(index: number): Ordinal {
  return { type: "objective", index };
}

/**
 * `outputs[i]` is the answer for objective `i`; a `null` entry is an objective whose call failed
 * and is left without facts (the caller decides whether that fails the lesson).
 */
export function mergeObjectiveFacts(outputs: readonly (Output | null)[]): MergedObjectiveFacts {
  const merged: MergedObjectiveFacts = {
    keyIdeas: [],
    misconceptions: [],
    vocabulary: [],
    workedExamples: [],
    questions: [],
    duplicates: {
      keyIdeas: 0,
      misconceptions: 0,
      vocabulary: 0,
      workedExamples: 0,
      questions: 0,
      conflicts: [],
      exampleRepeats: [],
    },
  };

  /**
   * One list's dedupe state: by key, the merged indices of every item that carries it, and by
   * full payload, the one merged index that payload has. `add` returns the merged index the item
   * ended at (an existing one when the payload was already there).
   */
  const listState = <T extends { objectiveRefs: Ordinal[] }>(list: MergeList, target: T[]) => {
    const byKey = new Map<string, number[]>();
    const byPayload = new Map<string, number>();
    return {
      add(key: string, item: T, ref: Ordinal): number {
        const { objectiveRefs: _refs, ...payload } = item;
        const full = normalisePayload(payload);
        const existing = byPayload.get(full);
        if (existing !== undefined) {
          target[existing]?.objectiveRefs.push(ref);
          merged.duplicates[list]++;
          return existing;
        }
        const at = target.length;
        target.push(item);
        byPayload.set(full, at);
        const sameKey = byKey.get(key) ?? [];
        sameKey.push(at);
        byKey.set(key, sameKey);
        if (sameKey.length > 1) {
          const conflict = merged.duplicates.conflicts.find(
            (c) => c.list === list && c.key === key,
          );
          // `objectives` is filled once every output is in: a kept item's refs still grow while
          // later outputs merge exact duplicates into it.
          if (conflict) conflict.indices.push(at);
          else
            merged.duplicates.conflicts.push({ list, key, indices: [...sameKey], objectives: [] });
        }
        return at;
      },
    };
  };
  const keyIdeas = listState("keyIdeas", merged.keyIdeas);
  const misconceptions = listState("misconceptions", merged.misconceptions);
  const vocabulary = listState("vocabulary", merged.vocabulary);
  const workedExamples = listState("workedExamples", merged.workedExamples);
  const questions = listState("questions", merged.questions);

  outputs.forEach((output, index) => {
    if (!output) return;
    const ref = ordinal(index);

    // Misconceptions first: worked examples and distractors point at them by index.
    const misconceptionIndex: number[] = [];
    for (const m of output.misconceptions) {
      misconceptionIndex.push(
        misconceptions.add(normaliseText(m.belief), { ...m, objectiveRefs: [ref] }, ref),
      );
    }
    const remap = (r: MisconceptionOrdinal | undefined): MisconceptionOrdinal | undefined => {
      if (!r) return undefined;
      const at = misconceptionIndex[r.index];
      return at === undefined ? undefined : { type: "misconception", index: at };
    };

    // Where each of this call's key ideas landed, for its questions' `keyIdeaRefs`.
    const keyIdeaIndex = output.keyIdeas.map((k) =>
      keyIdeas.add(normaliseText(k.statement), { ...k, objectiveRefs: [ref] }, ref),
    );
    for (const v of output.vocabulary) {
      // Audit A5: a term another objective already defined keeps the first definition; this
      // objective joins its refs. Two definitions of one word on two slides read as a contradiction.
      const first = merged.vocabulary.findIndex(
        (m) => normaliseText(m.term) === normaliseText(v.term),
      );
      if (first >= 0) {
        merged.vocabulary[first]?.objectiveRefs.push(ref);
        merged.duplicates.vocabulary++;
        continue;
      }
      vocabulary.add(normaliseText(v.term), { ...v, objectiveRefs: [ref] }, ref);
    }
    if (repeatsKeyIdeaExample(output)) merged.duplicates.exampleRepeats.push(index);
    for (const w of output.workedExamples) {
      const { misconceptionRef, objectiveRefs: declared, ...rest } = w;
      // The objectives the call names for the example (existing ones only, in order, once each);
      // when it names none, the objective the call was given.
      const named = [
        ...new Set(
          (declared ?? [])
            .map((r) => r.index)
            .filter((i) => Number.isInteger(i) && i >= 0 && i < outputs.length),
        ),
      ];
      const item: WorkedExample = {
        ...rest,
        objectiveRefs: named.length > 0 ? named.map(ordinal) : [ref],
        misconceptionRef: remap(misconceptionRef),
      };
      workedExamples.add(normaliseText(w.problem), item, ref);
    }
    for (const q of output.questions) {
      const { keyIdeaRefs: declaredKeyIdeas, ...restQ } = q;
      const tested = [
        ...new Set(
          (declaredKeyIdeas ?? []).flatMap((r) => {
            const at = Number.isInteger(r.index) ? keyIdeaIndex[r.index] : undefined;
            return at === undefined ? [] : [at];
          }),
        ),
      ];
      const item: Question = {
        ...restQ,
        ...(tested.length > 0
          ? { keyIdeaRefs: tested.map((index): KeyIdeaOrdinal => ({ type: "keyIdea", index })) }
          : {}),
        objectiveRefs: [ref],
        distractors: (q.distractors ?? []).map((d) => {
          const { misconceptionRef, ...restD } = d;
          return { ...restD, misconceptionRef: remap(misconceptionRef) };
        }),
      };
      questions.add(normaliseText(q.stem), item, ref);
    }
  });
  for (const conflict of merged.duplicates.conflicts) {
    const list: { objectiveRefs: Ordinal[] }[] = merged[conflict.list];
    conflict.objectives = conflict.indices.map(
      (i) => list[i]?.objectiveRefs.map((r) => r.index) ?? [],
    );
  }
  return merged;
}
