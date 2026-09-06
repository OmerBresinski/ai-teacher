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
import { docFromBullets, docFromText, uid } from "./factories";
import { docFromNumbered, layoutSlide, vocabularyGrid } from "./layouts";
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

export function materialiseSlide(
  spec: SlideSpec,
  themeId: string,
  meta: MaterialiseMeta,
  ids: IdSupplier = uid,
): Slide {
  const laid = reid(layoutSlide(spec.kind, themeId), ids);
  const filled = fillSlide(spec, themeId, laid, ids);
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

function fillSlide(spec: SlideSpec, themeId: string, laid: Layout, ids: IdSupplier): Layout {
  switch (spec.kind) {
    case "title":
      return fillTitle(spec, laid);
    case "objectives":
    case "instructions":
    case "exit-ticket":
    case "starter":
      return fillNumbered(spec, laid);
    case "vocabulary":
      return fillVocabulary(spec, themeId, laid);
    case "content":
      return fillContent(spec, laid);
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
      return fillPlenary(spec, laid);
  }
}

/* --- per-kind fillers --------------------------------------------- */

function fillTitle(spec: SlideSpecOf<"title">, laid: Layout): Layout {
  setText(textOf(laid, "title"), spec.title);
  setText(textOf(laid, "subtitle"), spec.subtitle);
  return laid;
}

type NumberedSpec = SlideSpecOf<"objectives" | "instructions" | "exit-ticket" | "starter">;

/** Heading, a numbered body and (where the recipe has one) a footnote. */
function fillNumbered(spec: NumberedSpec, laid: Layout): Layout {
  if (spec.heading) setText(textOf(laid, "heading"), spec.heading);
  const items = "items" in spec ? spec.items : spec.steps;
  setDoc(textOf(laid, "body"), docFromNumbered(items));
  if ("footnote" in spec && spec.footnote) setText(textOf(laid, "small"), spec.footnote);
  return laid;
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

function fillContent(spec: SlideSpecOf<"content">, laid: Layout): Layout {
  setText(textOf(laid, "heading"), spec.heading);
  setText(textOf(laid, "body"), spec.body);
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

function fillPlenary(spec: SlideSpecOf<"plenary">, laid: Layout): Layout {
  if (spec.heading) setText(textOf(laid, "heading"), spec.heading);
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
