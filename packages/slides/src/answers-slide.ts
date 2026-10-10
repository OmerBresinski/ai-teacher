import type { Lesson, OutlineEntry, Slide, Theme } from "@tj/domain/documents";
import { uid } from "./factories";
import { ANSWERS_NAME } from "./reflow";
import { answersOnOwnSlide } from "./structure";

/*
 * The answers slide of a check (prod-17, UX ruling 200): "<heading>: answers", straight after a
 * set whose answers panel would cover its questions. Stored slides pair with `facts.outline` by
 * position (proposals, edits, illustrate, evaluate), so the answers slide has an outline entry of
 * its own, marked `answersTo` the check's entry. Unlike a continuation (`continuation.ts`: one
 * entry, several slides with a " (continued)" heading), this is one entry per slide.
 */

/** The answers entry's id, from its check's: `s7` gives `a7`. Deterministic, so a re-run agrees. */
export const answersIdOf = (checkId: string): string => `a${checkId.replace(/^\D+/, "")}`;

type Deck = Pick<Lesson, "slides" | "facts">;

/** Whether `i` is the answers slide of the slide before it. */
function isAnswersAt(deck: Deck, i: number): boolean {
  const entry = deck.facts?.outline[i];
  const check = deck.facts?.outline[i - 1];
  return !!entry?.answersTo && entry.answersTo === check?.id;
}

/** The presenter's note on an answers slide: the check's own answer notes, or what it answers. */
function answersNote(check: Slide): string {
  return check.notes?.trim() || "The answers to the check on the slide before.";
}

/**
 * The deck with `slideId`'s answers slide brought up to date: a stale one after it (and its
 * entry) is dropped, then, if the slide's answers panel would cover its questions, the answers go
 * on a new slide straight after with a fresh entry. Run after Repair and whenever the check is
 * regenerated, so an answers slide never outlives the questions it answers. `inserted` says how
 * many slides now follow the check that were not there before (-1, 0 or 1).
 */
export function syncAnswersSlide<D extends Deck>(
  deck: D,
  slideId: string,
  theme: Theme,
  ids: () => string = uid,
): { deck: D; inserted: number } {
  const i = deck.slides.findIndex((s) => s.id === slideId);
  const check = deck.slides[i];
  if (!check || isAnswersAt(deck, i)) return { deck, inserted: 0 };
  // No answers on the check's face (no panel, no reveal): they already went to its answers slide,
  // or it has none, so there is nothing to bring up to date. A regenerated check carries its
  // answers again, as a panel or as reveals in its question cards.
  const answersOnFace = check.elements.some(
    (e) => e.name === ANSWERS_NAME || (e.revealStep ?? 0) > 0,
  );
  if (!answersOnFace) return { deck, inserted: 0 };
  const slides = [...deck.slides];
  const plan = deck.facts?.outline;
  const outline = plan ? [...plan] : undefined;
  let inserted = 0;
  if (isAnswersAt(deck, i + 1)) {
    slides.splice(i + 1, 1);
    outline?.splice(i + 1, 1);
    inserted -= 1;
  }
  const [own, page] = answersOnOwnSlide(check, theme, ids);
  slides[i] = own as Slide;
  const entry = plan?.[i];
  if (page) {
    const { diagram: _diagram, ...rest } = page;
    slides.splice(i + 1, 0, { ...rest, notes: answersNote(check) });
    if (outline && entry) outline.splice(i + 1, 0, answersEntry(entry));
    inserted += 1;
  }
  if (inserted === 0 && own === check) return { deck, inserted };
  const facts =
    deck.facts && outline && outline.length === slides.length
      ? { facts: { ...deck.facts, outline } }
      : {};
  return { deck: { ...deck, ...facts, slides }, inserted };
}

function answersEntry(check: OutlineEntry): OutlineEntry {
  return {
    id: answersIdOf(check.id),
    kind: check.kind,
    factRefs: [...check.factRefs],
    answersTo: check.id,
  };
}
