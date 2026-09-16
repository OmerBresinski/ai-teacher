/**
 * Learning objectives are stored once as a bare verb phrase ("Describe the arrangement of
 * particles in solids, liquids and gases") and rendered with the stem that fits the reader
 * (UX ruling 64, TEACH-198). The slide carries the stem in its heading and lists the phrases
 * under it; a worksheet header speaks for one pupil, so it carries the stem on the line itself.
 * No model call and no schema change: these are string helpers only, plus `applyObjectiveEdits`,
 * the pure rule for what an objective edit on the plan screen does to the facts (ADR 0029).
 */

import type { FactId, LessonFacts, Objective } from "./lesson-facts";

/** The objectives slide heading; the numbered lines under it complete the sentence. */
export const OBJECTIVES_SLIDE_HEADING = "By the end of this lesson I can";

/**
 * "I can", "I can't" or "I cannot" at the start of the phrase, any case: the one definition of
 * "the phrase already carries its stem", shared by both helpers. The word boundary keeps a word
 * that merely starts with "can" ("I candle") out.
 */
const STEM_ALREADY = /^i can(?:'t|not)?\b/i;

/** A phrase that starts with the pronoun "I" ("I can", "I know") keeps its capital. */
const PRONOUN_I = /^I\b/;

/**
 * The phrase with its first letter lower-cased so it can follow a stem. The first character is
 * left alone when the second character is upper-case (an acronym or a proper noun such as
 * "NASA" or "SI"; an all-capitals word is the same case, since its second letter is a capital),
 * or when the phrase starts with the pronoun "I". Trims the text; empty input gives an empty
 * string.
 */
function lowerFirst(text: string): string {
  const phrase = text.trim();
  if (phrase === "") return "";
  if (PRONOUN_I.test(phrase)) return phrase;
  const first = phrase.charAt(0);
  if (first === first.toLowerCase()) return phrase;
  const second = phrase.charAt(1);
  if (second !== "" && second !== second.toLowerCase()) return phrase;
  return first.toLowerCase() + phrase.slice(1);
}

/**
 * The objective as one pupil reads it: "I can " and the phrase with its first letter
 * lower-cased. A phrase that already starts with "I can" (or "I can't") comes back unchanged
 * apart from trimming, so the helper is idempotent. Empty or whitespace input gives "".
 */
export function pupilObjective(text: string): string {
  const phrase = text.trim();
  if (phrase === "") return "";
  if (STEM_ALREADY.test(phrase)) return `I${phrase.slice(1)}`;
  return `I can ${lowerFirst(phrase)}`;
}

/**
 * One line of a list under a shared stem (the slide heading): the phrase alone, first letter
 * lower-cased by the same rule. A phrase stored with its own "I can " is trimmed back to the
 * verb phrase so the stem is not said twice. A negative stem ("I can't", "I cannot") is not the
 * heading's stem and cannot be cut without changing the meaning, so the phrase is left whole,
 * capital "I" and all: the teacher sees the stored text and can fix it. Empty or whitespace
 * input gives "".
 */
export function objectiveLine(text: string): string {
  const phrase = text.trim();
  const own = STEM_ALREADY.exec(phrase);
  if (!own) return lowerFirst(phrase);
  if (own[0].toLowerCase() !== "i can") return `I${phrase.slice(1)}`;
  return lowerFirst(phrase.slice(own[0].length));
}

/** One objective as the plan screen submits it: an existing `id`, or none for a new one. */
export type ObjectiveEdit = { id?: string; text: string };

export type ObjectiveEditsResult = { facts: LessonFacts; shapeChanged: boolean };

const OBJECTIVE_ID = /^o(\d+)$/;

/**
 * The facts after the teacher edited the proposed objectives (ADR 0029, TDD §4.4). Pure: `facts`
 * is never mutated.
 *
 * The same ids, each once, as many as before → a text edit: only `objectives` changes (texts and
 * order), `shapeChanged: false`, and the plan stays as it is.
 *
 * Anything else → `shapeChanged: true`, and the caller re-plans with the objectives pinned. An
 * edit whose id is missing or unknown becomes a new objective with the next unused `o<n>`; a fact
 * whose `objectiveRefs` name only removed objectives is dropped, and the survivors lose their
 * references to removed objectives and dropped misconceptions. The outline is emptied: Plan
 * rebuilds it around the pinned objectives, so no `factRefs` can dangle.
 */
export function applyObjectiveEdits(
  facts: LessonFacts,
  objectives: readonly ObjectiveEdit[],
): ObjectiveEditsResult {
  const byId = new Map(facts.objectives.map((o) => [o.id, o]));
  const editIds = objectives.map((edit) => edit.id);
  const textOnly =
    objectives.length === facts.objectives.length &&
    new Set(editIds).size === editIds.length &&
    editIds.every((id) => id !== undefined && byId.has(id));
  if (textOnly) {
    const edited = objectives.map((edit) => ({ ...keep(byId, edit.id), text: edit.text }));
    return { facts: { ...structuredClone(facts), objectives: edited }, shapeChanged: false };
  }

  let next = 0;
  for (const o of facts.objectives) {
    const n = OBJECTIVE_ID.exec(o.id);
    if (n) next = Math.max(next, Number(n[1]));
  }
  const used = new Set<string>();
  const edited: Objective[] = objectives.map((edit) => {
    if (edit.id !== undefined && byId.has(edit.id) && !used.has(edit.id)) {
      used.add(edit.id);
      return { ...keep(byId, edit.id), text: edit.text };
    }
    next += 1;
    return { id: `o${next}`, text: edit.text };
  });
  const removed = new Set(facts.objectives.map((o) => o.id).filter((id) => !used.has(id)));

  // A fact survives unless every objective it served was removed; one with no references serves
  // the lesson as a whole and stays.
  const serves = <T extends { objectiveRefs?: FactId[] }>(fact: T): T | null => {
    const refs = fact.objectiveRefs;
    if (refs === undefined || refs.length === 0) return structuredClone(fact);
    const kept = refs.filter((ref) => !removed.has(ref));
    return kept.length === 0 ? null : { ...structuredClone(fact), objectiveRefs: kept };
  };
  const survivors = <T extends { objectiveRefs?: FactId[] }>(list: readonly T[]): T[] =>
    list.map(serves).filter((fact): fact is T => fact !== null);

  const misconceptions = survivors(facts.misconceptions);
  const misconceptionIds = new Set(misconceptions.map((m) => m.id));
  const dropMisconceptionRef = <T extends { misconceptionRef?: FactId }>(item: T): T => {
    if (item.misconceptionRef === undefined || misconceptionIds.has(item.misconceptionRef)) {
      return item;
    }
    const { misconceptionRef: _dropped, ...rest } = item;
    return rest as T;
  };

  const nextFacts: LessonFacts = {
    ...structuredClone(facts),
    objectives: edited,
    vocabulary: survivors(facts.vocabulary),
    workedExamples: facts.workedExamples.map((x) => dropMisconceptionRef(structuredClone(x))),
    questions: survivors(facts.questions).map((q) =>
      q.distractors === undefined
        ? q
        : { ...q, distractors: q.distractors.map(dropMisconceptionRef) },
    ),
    misconceptions,
    outline: [],
  };
  if (facts.keyIdeas !== undefined) nextFacts.keyIdeas = survivors(facts.keyIdeas);
  return { facts: nextFacts, shapeChanged: true };
}

/** A copy of the stored objective `id`, which the caller has checked exists. */
function keep(byId: Map<FactId, Objective>, id: FactId | undefined): Objective {
  return structuredClone(byId.get(id as FactId) as Objective);
}
