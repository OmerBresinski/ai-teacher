import type { Lesson, OutlineEntry, Slide, Theme } from "@tj/domain/documents";
import { entriesWritten, outlineIndices, richDocToPlainText } from "@tj/domain/documents";
import { uid } from "./factories";
import { ANSWERS_NAME } from "./reflow";
import { answersOnOwnSlide } from "./structure";

/*
 * The answers slide of a check (prod-17, UX ruling 200): "<heading>: answers", straight after a
 * set whose answers panel would cover its questions. Stored slides map to `facts.outline` through
 * `outlineIndices` (a continuation shares its entry; proposals, edits, illustrate, evaluate read
 * that way), so the answers slide, which is not a continuation, has an entry of its own right
 * after its check's, marked `answersTo` the check. Unlike a continuation (one entry, several
 * slides), this is one entry per slide.
 *
 * `syncAnswers` is the one place answers slides are added, kept or dropped: Repair runs it over
 * the finished deck and the editor runs it after a regenerate. After it, the deck holds:
 * - one entry per non-continuation slide (`entriesWritten(slides) === outline.length`);
 * - an answers entry only straight after the entry of the check it answers, and only while that
 *   check's answers are off its face;
 * - no answers panel that covers its questions.
 */

/** The answers entry's id, from its check's: `s7` gives `a7`. Deterministic, so a re-run agrees. */
export const answersIdOf = (checkId: string): string => `a${checkId.replace(/^\D+/, "")}`;

type Deck = Pick<Lesson, "slides" | "facts">;

/** Answers still on the slide's face: the panel, or reveals in its question cards. */
const answersOnFace = (slide: Slide): boolean =>
  slide.elements.some((e) => e.name === ANSWERS_NAME || (e.revealStep ?? 0) > 0);

/** An answers slide by its look, for a deck with no outline: the panel shown, "…: answers" heading. */
function isAnswersSlide(slide: Slide): boolean {
  const panel = slide.elements.some((e) => e.name === ANSWERS_NAME && !e.revealStep);
  const heading = slide.elements.some(
    (e) => e.type === "text" && richDocToPlainText(e.doc).trim().endsWith(": answers"),
  );
  return panel && heading;
}

/** The presenter's note on an answers slide: the check's own answer notes, or what it answers. */
function answersNote(check: Slide): string {
  return check.notes?.trim() || "The answers to the check on the slide before.";
}

function answersEntry(check: OutlineEntry): OutlineEntry {
  return {
    id: answersIdOf(check.id),
    kind: check.kind,
    factRefs: [...check.factRefs],
    answersTo: check.id,
  };
}

type Group = { entry: OutlineEntry | undefined; slides: Slide[] };

/**
 * The deck with every answers slide where it belongs (see the invariant above). `regenerated`
 * names check slides just rewritten: their old answers slide goes whatever the new slide holds,
 * and one comes back only if the new answers would cover the new questions. A deck whose outline
 * does not line up with its slides (mid-generation) is left as it is. Returns the same object when
 * nothing changes.
 */
export function syncAnswers<D extends Deck>(
  deck: D,
  theme: Theme,
  ids: () => string = uid,
  regenerated: ReadonlySet<string> = new Set(),
): D {
  const plan = deck.facts?.outline;
  if (plan && entriesWritten(deck.slides) !== plan.length) return deck;
  const at = outlineIndices(deck.slides);
  const groups: Group[] = [];
  deck.slides.forEach((slide, i) => {
    const k = at[i] ?? 0;
    const group = groups[k] ?? { entry: plan?.[k], slides: [] };
    group.slides.push(slide);
    groups[k] = group;
  });
  const isAnswersGroup = (g: Group, check: Group): boolean =>
    g.entry
      ? !!g.entry.answersTo && g.entry.answersTo === check.entry?.id
      : !plan && g.slides[0] !== undefined && isAnswersSlide(g.slides[0]);

  const slides: Slide[] = [];
  const outline: OutlineEntry[] = [];
  let changed = false;
  for (let k = 0; k < groups.length; k++) {
    const group = groups[k] as Group;
    // An answers slide is placed by its check below; one that reached here has lost its check.
    if (group.entry?.answersTo) {
      changed = true;
      continue;
    }
    const next = groups[k + 1];
    const existing = next && isAnswersGroup(next, group) ? next : undefined;
    if (existing) k += 1;
    const fresh = group.slides[0] !== undefined && regenerated.has(group.slides[0].id);

    let own = group.slides;
    let answers: Slide | undefined;
    if (own.some(answersOnFace)) {
      own = [];
      for (const slide of group.slides) {
        const [head, page] = answersOnOwnSlide(slide, theme, ids);
        own.push(head as Slide);
        if (page && !answers) {
          const { diagram: _diagram, ...rest } = page;
          answers = { ...rest, notes: answersNote(slide) };
        }
      }
      if (own.some((s, i) => s !== group.slides[i])) changed = true;
      if (existing) changed = true;
    } else if (existing && !fresh) {
      answers = existing.slides[0];
      if (existing.slides.length > 1) changed = true;
    } else if (existing) {
      // Regenerated with no answers at all: its old answers slide answers nothing now.
      changed = true;
    }

    slides.push(...own);
    if (group.entry) outline.push(group.entry);
    if (answers) {
      slides.push(answers);
      if (answers !== existing?.slides[0]) changed = true;
      if (group.entry) outline.push(existing?.entry ?? answersEntry(group.entry));
    }
  }
  if (!changed) return deck;
  const facts = deck.facts && plan ? { facts: { ...deck.facts, outline } } : {};
  return { ...deck, ...facts, slides };
}
