import type { LessonFacts } from "@tj/domain/documents";
import { codedSetSpec } from "./coded-slides";

/*
 * Lab r3 (tested-not-taught, lab/r2/checks.md §3): a teaching slide is shown the questions later in
 * the lesson that test its key ideas, stem and answer, read-only, so it teaches the detail their
 * answers need. The structural check works at key-idea level and cannot see a detail the slide
 * compressed away; this hands the writer the detail instead.
 *
 * Only questions that land on a later slide count: a code-built set (check, exit quiz) counts the
 * lines it actually prints (`codedSetSpec`'s `questionRefs`, after the line and character caps); a
 * model-written practise or check slide counts the questions its entry names. A starter asks before
 * teaching and never counts. At most `LATER_QUESTIONS_MAX`, shortest first, so the input stays small.
 */

export const LATER_QUESTIONS_MAX = 4;

export type LaterQuestion = { stem: string; answer: string };

const TEACHING_KINDS: ReadonlySet<string> = new Set(["content", "image-text", "worked-example"]);
const ASKING_PHASES: ReadonlySet<string> = new Set(["practise", "check"]);

/** The question ids that land on outline entry `j` (none for a teaching slide or a starter). */
function landedQuestionRefs(facts: LessonFacts, j: number, seed: string): string[] {
  const entry = facts.outline[j];
  if (!entry || TEACHING_KINDS.has(entry.kind)) return [];
  if (entry.kind === "starter" || entry.phase === "starter") return [];
  const coded = codedSetSpec(entry, facts, `${seed}:${j}`);
  if (coded) return coded.questionRefs;
  const asks =
    entry.kind === "exit-ticket" || (entry.phase !== undefined && ASKING_PHASES.has(entry.phase));
  if (!asks) return [];
  const ids = new Set(facts.questions.map((q) => q.id));
  return entry.factRefs.filter((ref) => ids.has(ref));
}

/**
 * The later questions that test the key ideas outline entry `index` teaches, or `undefined` when
 * the entry is not a teaching slide, names no key idea, or no later slide asks about one.
 * `seed`: the lesson id, as Generate seeds its coded sets.
 */
export function laterQuestionsFor(
  facts: LessonFacts,
  index: number,
  seed: string,
): LaterQuestion[] | undefined {
  const entry = facts.outline[index];
  if (!entry || !TEACHING_KINDS.has(entry.kind)) return undefined;
  const keyIdeaIds = new Set((facts.keyIdeas ?? []).map((k) => k.id));
  const taught = new Set(entry.factRefs.filter((ref) => keyIdeaIds.has(ref)));
  if (taught.size === 0) return undefined;
  const questions = new Map(facts.questions.map((q) => [q.id, q]));
  const picked = new Set<string>();
  for (let j = index + 1; j < facts.outline.length; j++) {
    for (const ref of landedQuestionRefs(facts, j, seed)) {
      const q = questions.get(ref);
      if (q?.keyIdeaRefs?.some((k) => taught.has(k))) picked.add(ref);
    }
  }
  const list = [...picked]
    .map((ref) => questions.get(ref))
    .filter((q) => q !== undefined)
    .map((q) => ({ stem: q.stem.trim(), answer: q.answer.trim() }))
    // Stable: equal lengths keep lesson order.
    .sort((a, b) => a.stem.length + a.answer.length - (b.stem.length + b.answer.length))
    .slice(0, LATER_QUESTIONS_MAX);
  return list.length > 0 ? list : undefined;
}
