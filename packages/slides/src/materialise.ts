import type {
  GapTextElement,
  GeneratedFrom,
  Id,
  OptionElement,
  QuestionData,
  RichDoc,
  Slide,
  SlideElement,
  TextElement,
  TextPreset,
  WorksheetBlock,
} from "@tj/domain/documents";
import { OBJECTIVES_SLIDE_HEADING, objectiveLine } from "@tj/domain/documents";
import { docFromBullets, docFromText, uid } from "./factories";
import {
  type ContentVariant,
  docFromNumbered,
  LIST_SLOTS,
  type ListVariant,
  layoutSlide,
  type TitleVariant,
  variantName,
  vocabularyGrid,
} from "./layouts";
import { type BlockSpec, GAP_MARKER, type SlideSpec, type SlideSpecOf } from "./specs";
import { getTheme } from "./themes";

/*
 * Materialise (ADR 0025 §8): a spec in, a laid-out Slide or WorksheetBlock out. The recipe in
 * `layouts.ts` decides every coordinate; this file only replaces the placeholder copy, sets the
 * answer data and stamps provenance. One small `fill*` function per kind, no template engine.
 *
 * Ids: the recipe mints its own with `uid()`; they are all re-minted through `ids` so a caller
 * with a deterministic supplier gets a deterministic slide, and question references follow.
 */

/** Provenance stamped on every element and block (ADR 0025 §2). */
export type MaterialiseMeta = { promptVersion: string; model: string; at: string };

/** Supplies element ids; defaults to `uid()`. Tests pass a counter. */
export type IdSupplier = () => Id;

type Provenance = { generatedFrom: GeneratedFrom; authoredBy: "ai" };

const provenance = (factRefs: string[], meta: MaterialiseMeta): Provenance => ({
  generatedFrom: { factRefs, ...meta },
  authoredBy: "ai",
});

/* ------------------------------------------------------------------ */
/* Slides                                                              */
/* ------------------------------------------------------------------ */

/**
 * `variant` picks a composition from `LAYOUT_CATALOGUE[spec.kind]` by index or name (see
 * `layoutSlide`); left out, the kind's default. The fillers below find a variant's slots by
 * `name` where its presets differ from the default recipe's.
 */
export function materialiseSlide(
  spec: SlideSpec,
  themeId: string,
  meta: MaterialiseMeta,
  ids: IdSupplier = uid,
  variant: number | string = 0,
): Slide {
  const laid = reid(layoutSlide(spec.kind, themeId, variant), ids);
  const filled = fillSlide(spec, themeId, laid, ids, variant);
  const stamp = provenance(spec.factRefs, meta);
  const slide: Slide = {
    id: ids(),
    kind: spec.kind,
    elements: filled.elements.map((element) => stampElement(element, stamp)),
  };
  if (filled.question) slide.question = filled.question;
  if (spec.notes) slide.notes = spec.notes;
  return slide;
}

type Layout = { elements: SlideElement[]; question?: QuestionData };

function fillSlide(
  spec: SlideSpec,
  themeId: string,
  laid: Layout,
  ids: IdSupplier,
  variant: number | string,
): Layout {
  switch (spec.kind) {
    case "title":
      return fillTitle(spec, laid, variantName(spec.kind, variant));
    case "objectives":
      return fillObjectives(spec, laid, variantName(spec.kind, variant));
    case "instructions":
    case "exit-ticket":
    case "starter":
      return fillNumbered(spec, laid, variantName(spec.kind, variant));
    case "vocabulary":
      return fillVocabulary(spec, themeId, laid);
    case "content":
      return fillContent(spec, laid, variantName(spec.kind, variant));
    case "image-text":
      return fillImageText(spec, laid);
    case "worked-example":
      return fillWorkedExample(spec, laid);
    case "discussion":
      return fillDiscussion(spec, laid);
    case "true-false":
      return fillTrueFalse(spec, laid);
    case "multiple-choice":
      return fillMultipleChoice(spec, laid);
    case "matching":
      return fillMatching(spec, laid);
    case "fill-gap":
      return fillGap(spec, laid, ids);
    case "sort":
      return fillSort(spec, laid);
    case "open-response":
      return fillOpenResponse(spec, laid);
    case "plenary":
      return fillPlenary(spec, laid, variantName(spec.kind, variant));
  }
}

/* --- per-kind fillers --------------------------------------------- */

function fillTitle(spec: SlideSpecOf<"title">, laid: Layout, variant: TitleVariant): Layout {
  setText(textOf(laid, "title"), spec.title);
  // The photo-band variant sets the class line in `small`, named so it can be found.
  setText(
    variant === "photo-band" ? slot(laid, "Subtitle") : textOf(laid, "subtitle"),
    spec.subtitle,
  );
  return laid;
}

/**
 * The objectives slide always carries the reader's stem as its heading (UX ruling 64,
 * TEACH-198): the spec has no heading for the model to get wrong. Objectives are stored as bare
 * verb phrases; under the stem each line starts lower-case.
 */
/**
 * The stem as the heading and the lower-cased phrases under it (TEACH-198) on every variant:
 * one numbered doc, or one phrase per card or step.
 */
function fillObjectives(
  spec: SlideSpecOf<"objectives">,
  laid: Layout,
  variant: ListVariant,
): Layout {
  setText(textOf(laid, "heading"), OBJECTIVES_SLIDE_HEADING);
  const lines = spec.items.map(objectiveLine);
  if (variant !== "numbered") return fillItems(laid, lines, LIST_SLOTS.objectives);
  setDoc(textOf(laid, "body"), docFromNumbered(lines));
  return laid;
}

type NumberedSpec = SlideSpecOf<"instructions" | "exit-ticket" | "starter">;

/** Heading, a numbered body and (where the recipe has one) a footnote. */
function fillNumbered(spec: NumberedSpec, laid: Layout, variant: ListVariant): Layout {
  if (spec.heading) setText(textOf(laid, "heading"), spec.heading);
  const items = "items" in spec ? spec.items : spec.steps;
  if (variant !== "numbered") {
    laid = fillItems(laid, items, LIST_SLOTS[spec.kind]);
  } else {
    setDoc(textOf(laid, "body"), docFromNumbered(items));
  }
  if ("footnote" in spec && spec.footnote) setText(textOf(laid, "small"), spec.footnote);
  return laid;
}

/** The slot number an item-per-element variant gave an element: "Item 3", "Card 3", "Step 3". */
const ITEM_SLOT = /^(?:Item|Card|Step) (\d+)$/;

/**
 * The `cards` and `stepped` list variants lay one slot per item the kind's spec may carry
 * ("Item n" and its "Card n" or "Step n", `LIST_SLOTS`). Fill the first `items.length` in
 * order and drop the rest, so no placeholder survives. More items than slots is refused, not
 * trimmed: a line of a lesson must never vanish from a slide without a word.
 */
function fillItems(laid: Layout, items: string[], slots: number): Layout {
  if (items.length > slots) {
    throw new Error(`recipe lays ${slots} item slots and the spec fills ${items.length}`);
  }
  const kept: SlideElement[] = [];
  for (const element of laid.elements) {
    const slot = element.name?.match(ITEM_SLOT);
    if (!slot) {
      kept.push(element);
      continue;
    }
    const item = items[Number(slot[1]) - 1];
    if (item === undefined) continue;
    if (element.type === "text" && element.name?.startsWith("Item")) setText(element, item);
    kept.push(element);
  }
  return { ...laid, elements: kept };
}

/**
 * How many term/definition entries the vocabulary recipe shows on a theme (`rows * 2`, two
 * columns). Exported so a prompt can ask for no more than the slide will show.
 */
export function vocabularySlots(themeId: string): number {
  return vocabularyGrid(getTheme(themeId)).rows * 2;
}

/**
 * The recipe lays out `vocabularySlots` term/definition slots, each after the first in a column
 * preceded by a hairline. Fill the first `entries.length` slots in order and drop the rest —
 * rule, term and definition together — so no placeholder survives. Entries beyond the slots are
 * not shown: the caller keeps the spec within `vocabularySlots(themeId)`.
 */
function fillVocabulary(spec: SlideSpecOf<"vocabulary">, themeId: string, laid: Layout): Layout {
  const entries = spec.entries.slice(0, vocabularySlots(themeId));
  const kept: SlideElement[] = [];
  let slot = -1;
  for (const element of laid.elements) {
    if (element.type === "text" && element.style.preset === "body") {
      slot += 1;
      const entry = entries[slot];
      if (!entry) continue;
      setText(element, entry.term);
      kept.push(element);
    } else if (element.type === "text" && element.style.preset === "small") {
      const entry = entries[slot];
      if (!entry) continue;
      setText(element, entry.definition);
      kept.push(element);
    } else if (element.type === "shape" && element.name === "Rule" && kept.length > 2) {
      // A rule above a term belongs to the slot it introduces; the heading's hairline (the
      // second element) always stays.
      if (slot + 1 < entries.length) kept.push(element);
    } else {
      kept.push(element);
    }
  }
  return { ...laid, elements: kept };
}

function fillContent(spec: SlideSpecOf<"content">, laid: Layout, variant: ContentVariant): Layout {
  if (variant === "statement") {
    // No heading on a statement: the heading becomes the eyebrow over the sentence.
    setText(slot(laid, "Eyebrow"), spec.heading);
    setText(slot(laid, "Statement"), spec.body);
    return laid;
  }
  setText(textOf(laid, "heading"), spec.heading);
  if (variant === "two-column") {
    const [left, right] = splitAtFullStop(spec.body);
    setText(slot(laid, "Body left"), left);
    const rightSlot = slot(laid, "Body right");
    if (right) {
      setText(rightSlot, right);
      return laid;
    }
    // One sentence with no full stop to split at: the left column carries it all.
    return { ...laid, elements: laid.elements.filter((element) => element !== rightSlot) };
  }
  setText(textOf(laid, "body"), spec.body);
  return laid;
}

/**
 * Split a body at its first full stop that is followed by more text: the first sentence
 * left, the rest right. A body with no such full stop comes back whole with an empty right.
 */
export function splitAtFullStop(body: string): [string, string] {
  const at = body.search(/\.\s+\S/);
  if (at < 0) return [body.trim(), ""];
  return [body.slice(0, at + 1).trim(), body.slice(at + 1).trim()];
}

function fillImageText(spec: SlideSpecOf<"image-text">, laid: Layout): Layout {
  setText(textOf(laid, "heading"), spec.heading);
  setText(textOf(laid, "body"), spec.body);
  // The image slot stays as the recipe made it: PLACEHOLDER_IMAGE until `illustrate` places a
  // photograph (or leaves it, with a warning finding, when Pexels has nothing).
  return laid;
}

function fillWorkedExample(spec: SlideSpecOf<"worked-example">, laid: Layout): Layout {
  if (spec.heading) setText(textOf(laid, "heading"), spec.heading);
  const [question, working] = textsOf(laid, "body");
  setText(question, spec.question);
  setDoc(working, docFromNumbered(spec.steps));
  return laid;
}

function fillDiscussion(spec: SlideSpecOf<"discussion">, laid: Layout): Layout {
  setText(textOf(laid, "subtitle"), spec.prompt);
  if (spec.footnote) setText(textOf(laid, "small"), spec.footnote);
  return laid;
}

function fillTrueFalse(spec: SlideSpecOf<"true-false">, laid: Layout): Layout {
  setText(textOf(laid, "heading"), spec.statement);
  const question: QuestionData = { type: "true-false", correct: spec.correct };
  if (spec.explanation) question.explanation = spec.explanation;
  return { ...laid, question };
}

function fillMultipleChoice(spec: SlideSpecOf<"multiple-choice">, laid: Layout): Layout {
  setText(textOf(laid, "heading"), spec.stem);
  const options = optionsOf(laid);
  spec.options.forEach((option, i) => {
    setDoc(options[i], docFromText(option.text));
  });
  const question: QuestionData = {
    type: "multiple-choice",
    options: options.map((element, i) => ({ id: element.id, correct: !!spec.options[i]?.correct })),
  };
  if (spec.explanation) question.explanation = spec.explanation;
  return { ...laid, question };
}

/** Three term cards left, three definition cards right; the recipe's pairs already join them. */
function fillMatching(spec: SlideSpecOf<"matching">, laid: Layout): Layout {
  setText(textOf(laid, "heading"), spec.stem);
  const cards = textsOf(laid, "body");
  const half = cards.length / 2;
  spec.pairs.forEach((pair, i) => {
    setText(cards[i], pair.left);
    setText(cards[half + i], pair.right);
  });
  return laid;
}

/** `___` markers become `[[gap:id]]` tokens left to right; the answers follow in order. */
function fillGap(spec: SlideSpecOf<"fill-gap">, laid: Layout, ids: IdSupplier): Layout {
  setText(textOf(laid, "heading"), spec.stem);
  const gaps = spec.answers.map((answer) => ({ id: ids(), answer }));
  const gapText = laid.elements.find((element): element is GapTextElement => {
    return element.type === "gap-text";
  });
  if (!gapText) throw new Error("fill-gap recipe has no gap-text element");
  gapText.doc = docFromText(gapTokens(spec.sentence, gaps));
  return { ...laid, question: { type: "fill-gap", gaps } };
}

function fillSort(spec: SlideSpecOf<"sort">, laid: Layout): Layout {
  setText(textOf(laid, "heading"), spec.stem);
  const cards = optionsOf(laid);
  spec.steps.forEach((step, i) => {
    setDoc(cards[i], docFromText(step));
  });
  return { ...laid, question: { type: "sort", order: cards.map((card) => card.id) } };
}

function fillOpenResponse(spec: SlideSpecOf<"open-response">, laid: Layout): Layout {
  setText(textOf(laid, "heading"), spec.stem);
  const question: QuestionData = { type: "open-response" };
  if (spec.modelAnswer) question.modelAnswer = spec.modelAnswer;
  return { ...laid, question };
}

function fillPlenary(spec: SlideSpecOf<"plenary">, laid: Layout, variant: ListVariant): Layout {
  if (spec.heading) setText(textOf(laid, "heading"), spec.heading);
  if (variant !== "numbered") return fillItems(laid, spec.items, LIST_SLOTS.plenary);
  setDoc(textOf(laid, "body"), docFromBullets(spec.items));
  return laid;
}

/* ------------------------------------------------------------------ */
/* Blocks                                                              */
/* ------------------------------------------------------------------ */

export function materialiseBlock(
  spec: BlockSpec,
  meta: MaterialiseMeta,
  ids: IdSupplier = uid,
): WorksheetBlock {
  const id = ids();
  const stamp = provenance(spec.factRefs, meta);
  switch (spec.type) {
    case "heading":
      return { id, type: "heading", doc: docFromText(spec.text), level: spec.level, ...stamp };
    case "instructions":
      return { id, type: "instructions", doc: docFromText(spec.text), ...stamp };
    case "paragraph":
      return { id, type: "paragraph", doc: docFromText(spec.text), ...stamp };
    case "question": {
      const block: WorksheetBlock = {
        id,
        type: "question",
        doc: docFromText(spec.text),
        answerLines: spec.answerLines,
        answer: spec.answer,
        ...stamp,
      };
      if (spec.marks !== undefined) block.marks = spec.marks;
      return block;
    }
    case "multiple-choice":
      return {
        id,
        type: "multiple-choice",
        doc: docFromText(spec.text),
        options: spec.options.map((option) => ({ id: ids(), ...option })),
        ...stamp,
      };
    case "fill-gap": {
      const gaps = spec.answers.map((answer) => ({ id: ids(), answer }));
      return {
        id,
        type: "fill-gap",
        doc: docFromText(gapTokens(spec.sentence, gaps)),
        gaps,
        ...stamp,
      };
    }
    case "matching":
      return {
        id,
        type: "matching",
        pairs: spec.pairs.map((pair) => ({ id: ids(), ...pair })),
        ...stamp,
      };
    case "word-bank":
      return { id, type: "word-bank", words: spec.words, ...stamp };
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Every `___` in `sentence` becomes the next gap's `[[gap:id]]` token, left to right. */
function gapTokens(sentence: string, gaps: { id: Id }[]): string {
  let i = 0;
  return sentence.replaceAll(GAP_MARKER, () => `[[gap:${gaps[i++]?.id ?? ""}]]`);
}

function textsOf(laid: Layout, preset: TextPreset): TextElement[] {
  return laid.elements.filter(
    (element): element is TextElement => element.type === "text" && element.style.preset === preset,
  );
}

function textOf(laid: Layout, preset: TextPreset): TextElement {
  const element = textsOf(laid, preset)[0];
  if (!element) throw new Error(`recipe has no ${preset} text element`);
  return element;
}

/** A text slot a variant names ("Statement", "Body left"); missing is a recipe bug, not a default. */
function slot(laid: Layout, name: string): TextElement {
  const named = laid.elements.find(
    (element): element is TextElement => element.type === "text" && element.name === name,
  );
  if (!named) throw new Error(`recipe has no text element named "${name}"`);
  return named;
}

function optionsOf(laid: Layout): OptionElement[] {
  return laid.elements.filter((element): element is OptionElement => element.type === "option");
}

function setText(element: TextElement | undefined, text: string): void {
  setDoc(element, docFromText(text));
}

function setDoc(element: TextElement | OptionElement | undefined, doc: RichDoc): void {
  if (!element) throw new Error("recipe has fewer slots than the spec fills");
  element.doc = doc;
}

function stampElement(element: SlideElement, stamp: Provenance): SlideElement {
  if (element.type === "group") {
    return {
      ...element,
      ...stamp,
      children: element.children.map((child) => stampElement(child, stamp)),
    };
  }
  return { ...element, ...stamp };
}

/**
 * Re-mint every element id through `ids` and re-point the recipe's question references, so
 * the output depends on the supplier alone. Gap ids are not touched: `fillGap` rebuilds them.
 */
function reid(laid: Layout, ids: IdSupplier): Layout {
  const map = new Map<Id, Id>();
  const fresh = (id: Id): Id => {
    const next = map.get(id) ?? ids();
    map.set(id, next);
    return next;
  };
  const rename = (element: SlideElement): SlideElement => {
    const renamed = { ...element, id: fresh(element.id) };
    if (renamed.type === "group") renamed.children = renamed.children.map(rename);
    return renamed;
  };
  const elements = laid.elements.map(rename);
  const m = (id: Id) => map.get(id) ?? id;
  let question = laid.question;
  if (question?.type === "multiple-choice") {
    question = { ...question, options: question.options.map((o) => ({ ...o, id: m(o.id) })) };
  } else if (question?.type === "matching") {
    question = {
      ...question,
      pairs: question.pairs.map((p) => ({
        id: ids(),
        leftElementId: m(p.leftElementId),
        rightElementId: m(p.rightElementId),
      })),
    };
  } else if (question?.type === "sort") {
    question = { ...question, order: question.order.map(m) };
  }
  return question ? { elements, question } : { elements };
}
