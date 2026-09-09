import type { SlideKind } from "@tj/domain/documents";
import { compositionOf, LAYOUT_CATALOGUE, variantsFor } from "./layouts";

/*
 * The variety rules (research §3.5), as one pure function over a slide's place in the deck.
 * No randomness: the same kind and context give the same variant, so a fixture lesson lays
 * out the same way every run and the editor's "Try another look" can step through the same
 * list. The generation pipeline calls this after the outline and before `generate`; the
 * demo lesson and the screenshot specs call it directly.
 */

/** The three moods a lesson can be set in (research §5); a theme tag or a lesson setting. */
export type Personality = "calm" | "bold" | "playful";

export type VariantContext = {
  /** Position in the deck, from 0. */
  index: number;
  /** Slides in the deck. */
  total: number;
  /** Whether the slide has a photograph to place (the illustrator has one for it). */
  hasImage?: boolean;
  /** Words in the slide's body copy: the paragraph, the items, or the title. */
  textLength?: number;
  /** The variant the slide before this one was given, or nothing for the first slide. */
  previousVariant?: string | null;
  /**
   * The kind of the slide before this one. Needed for the composition of `previousVariant`
   * (the same name can mean two things on two kinds) and for the rule that keeps a heading
   * on the first content slide after the objectives.
   */
  previousKind?: SlideKind | null;
  personality?: Personality;
};

/** Bodies shorter than this may be set as a single statement. */
export const STATEMENT_MAX_WORDS = 20;
/** Bodies longer than this are split into two columns. */
export const TWO_COLUMN_MIN_WORDS = 40;
/** Lists longer than this, in words, do not go on cards: three cards across are narrow. */
export const CARDS_MAX_WORDS = 45;
/** Titles up to this many words sit beside a half-slide photograph; longer ones take the band. */
export const SPLIT_MAX_WORDS = 5;

/** Count the words in a run of copy, for `VariantContext.textLength`. */
export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * The variants a slide may take, best first, before the adjacency rule is applied.
 * Only the families in the catalogue with more than one variant are ranked; every other
 * kind has one composition and keeps it.
 */
function ranked(kind: SlideKind, ctx: VariantContext): string[] {
  const words = ctx.textLength ?? 0;
  switch (kind) {
    case "title":
      if (!ctx.hasImage) return ["stack"];
      return words <= SPLIT_MAX_WORDS
        ? ["split", "photo-band", "stack"]
        : ["photo-band", "split", "stack"];
    case "content": {
      // A statement has no heading to anchor it, which the first idea after the objectives
      // needs; and a body over twenty words runs past three lines at subtitle size.
      const statement = words < STATEMENT_MAX_WORDS && ctx.previousKind !== "objectives";
      if (statement) return ["statement", "headed"];
      return words > TWO_COLUMN_MIN_WORDS ? ["two-column", "headed"] : ["headed", "two-column"];
    }
    case "objectives":
    case "starter":
    case "instructions":
    case "plenary": {
      const order =
        ctx.personality === "playful"
          ? ["cards", "stepped", "numbered"]
          : ctx.personality === "bold"
            ? ["stepped", "cards", "numbered"]
            : ["numbered", "stepped", "cards"];
      return words > CARDS_MAX_WORDS ? order.filter((v) => v !== "cards") : order;
    }
    default:
      return variantsFor(kind).slice(0, 1);
  }
}

/**
 * The composition of the slide before. Without `previousKind` the name is looked up across
 * the catalogue, which is enough for every name a variant has today.
 */
function previousComposition(ctx: VariantContext): string | null {
  if (ctx.previousVariant == null) return null;
  if (ctx.previousKind) return compositionOf(ctx.previousKind, ctx.previousVariant);
  for (const variants of Object.values(LAYOUT_CATALOGUE)) {
    const found = variants.find((v) => v.name === ctx.previousVariant);
    if (found) return found.composition;
  }
  return ctx.previousVariant;
}

/**
 * Choose the variant a slide is laid out in. The rules, in order:
 *
 * 1. Kinds with one composition (the question kinds, vocabulary, the picture slides) keep it.
 * 2. The exit ticket is always `numbered`: pupils write from it, so it stays plain.
 * 3. A title takes a photograph only when it has one: `split` for a title of up to five
 *    words, `photo-band` for a longer one, `stack` otherwise.
 * 4. A content body under twenty words is a `statement`, unless the slide follows the
 *    objectives; over forty words it is `two-column`; between, `headed`.
 * 5. A headed list is `numbered`, then `stepped`, then `cards` when the lesson is calm or
 *    has no personality; `cards` first when playful, `stepped` first when bold. A list over
 *    forty-five words never goes on cards.
 * 6. No two adjacent slides share a composition: the first choice whose composition differs
 *    from the previous slide's wins. A content `headed` paragraph and a list's `numbered`
 *    body are the same composition. When every choice would repeat it, the first stands.
 */
export function chooseVariant(kind: SlideKind, ctx: VariantContext): string {
  const first = LAYOUT_CATALOGUE[kind][0]?.name ?? "default";
  if (LAYOUT_CATALOGUE[kind].length <= 1 || kind === "exit-ticket") return first;
  const previous = previousComposition(ctx);
  const candidates = ranked(kind, ctx);
  return (
    candidates.find((name) => compositionOf(kind, name) !== previous) ?? candidates[0] ?? first
  );
}
