import type { Slide, SlideElement, Theme } from "@tj/domain/documents";
import { PHOTO_NAME, withoutDiagramSlot } from "@tj/slides";
import { PLACEHOLDER_IMAGE } from "@tj/slides/layouts";

/*
 * TEACH-251 part av: since a lesson turns editable at its words, a job can stop (a failure, a
 * cancel, a budget stop) or be retried while some picture slots are still open. No slot stays open
 * after the job: each is searched once more where the job can (a retry), and whatever is still
 * open is laid away, the words across the slide, as the final deck does for a lost picture.
 */

type Image = Extract<SlideElement, { type: "image" }>;
type AnySlide = { id: string; elements: unknown[] };

/** A picture slot the job holds open: its placeholder picture, never a teacher's blank box. */
export function isOpenJobSlot(el: unknown): el is Image {
  const e = el as { type?: string; src?: unknown; alt?: unknown };
  return (
    e.type === "image" &&
    e.src === PLACEHOLDER_IMAGE &&
    !String(e.alt ?? "").startsWith("Describe this")
  );
}

export const hasOpenJobSlots = (slides: readonly AnySlide[]): boolean =>
  slides.some((s) => s.elements.some(isOpenJobSlot));

/** One open slot to search: its slide's index, the slot and what it should show (its alt). */
export interface OpenSlot {
  index: number;
  slide: AnySlide;
  slot: Image;
  key: string;
}

export interface FoundPicture {
  src: string;
  alt: string;
}

/** `slide` laid without its open job slots: the slot a lost picture leaves never stays. */
export function withoutOpenSlots<T extends AnySlide>(slide: T, theme: Theme): T {
  if (!slide.elements.some(isOpenJobSlot)) return slide;
  // Named as the open photo slot the class view lays away, so the words take the room it held.
  const named = {
    ...slide,
    elements: slide.elements.map((e) =>
      isOpenJobSlot(e) ? { ...e, name: PHOTO_NAME, src: PLACEHOLDER_IMAGE } : e,
    ),
  } as unknown as Slide;
  const away = withoutDiagramSlot(named, theme) as unknown as T;
  // A slide the relayout does not take (not a content slide): the slot alone goes.
  return {
    ...away,
    elements: away.elements.filter((e) => !isOpenJobSlot(e)),
  };
}

/**
 * Every open job slot of `slides`, searched once (`search`, all at once, absent when the job is
 * stopping) and filled in its frame when a picture is found; the rest laid away.
 */
export async function resolveOpenSlots<T extends AnySlide>(
  slides: T[],
  o: { theme: Theme; search?: (open: OpenSlot[]) => Promise<Map<string, FoundPicture>> },
): Promise<{ slides: T[]; open: number; placed: number }> {
  const open: OpenSlot[] = slides.flatMap((slide, index) =>
    slide.elements
      .filter(isOpenJobSlot)
      .map((slot) => ({ index, slide, slot, key: `${index}:${slot.id}` })),
  );
  if (!open.length) return { slides, open: 0, placed: 0 };
  const found = o.search ? await o.search(open).catch(() => new Map()) : new Map();
  let placed = 0;
  const out = slides.map((slide, index) => {
    if (!slide.elements.some(isOpenJobSlot)) return slide;
    const filled = {
      ...slide,
      elements: slide.elements.map((e) => {
        if (!isOpenJobSlot(e)) return e;
        const pic = found.get(`${index}:${e.id}`);
        if (!pic) return e;
        placed++;
        return { ...e, src: pic.src, alt: pic.alt || e.alt, fit: "cover" };
      }),
    };
    return withoutOpenSlots(filled, o.theme);
  });
  return { slides: out, open: open.length, placed };
}
