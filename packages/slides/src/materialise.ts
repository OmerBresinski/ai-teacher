import type {
  GapTextElement,
  GeneratedFrom,
  Id,
  OptionElement,
  QuestionData,
  RichDoc,
  RichNode,
  Slide,
  SlideElement,
  TextElement,
  TextPreset,
  Theme,
  WorksheetBlock,
} from "@tj/domain/documents";
import { OBJECTIVES_SLIDE_HEADING, objectiveLine, richDocToPlainText } from "@tj/domain/documents";
import { applyCallout, detachCallout, isCalloutElement, placeCallout } from "./callout";
import { type ContentShape, shapeOf } from "./content-shapes";
import { docFromBullets, docFromText, uid } from "./factories";
import { diagramVariantFor, drawFigure, figureGroupOf } from "./figures";
import { fitSlide } from "./fit-slide";
import { SAFE } from "./grid";
import {
  AGENDA_OBJECTIVES,
  AGENDA_STEM,
  type ContentVariant,
  docFromNumbered,
  IDEA_NAME,
  LIST_SLOTS,
  type ListVariant,
  layoutSlide,
  type TitleVariant,
  variantName,
  vocabularyGrid,
} from "./layouts";
import {
  applyLook,
  DIAGRAM_NAME,
  isDiagramMark,
  isOpenPhotoSlot,
  KEY_IDEA_NAME,
  KIND_TAG_NAME,
  PHOTO_NAME,
  stripLook,
  withDiagramSlot,
  withPhotoSlot,
} from "./look";
import { HEADING_NAME } from "./reflow";
import { type BlockSpec, GAP_MARKER, type SlideSpec, type SlideSpecOf } from "./specs";
import {
  BODY_NAME,
  BULLET_NAME,
  COMPARE_NAME,
  continueParagraph,
  ITEM_NAME,
  LEAD_NAME,
  PANEL_DEFINITION_NAME,
  PANEL_LABEL_NAME,
  PANEL_NAME,
  PANEL_TEXT_NAME,
  type SlideStructure,
  STEP_NAME,
  structureSlide,
  withTerms,
} from "./structure";
import { measureHeadless } from "./text-measure";
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
 * `layoutSlide`); left out, the kind's default, or for a diagram its Figure template's
 * (`defaultVariant`). The fillers below find a variant's slots by `name` where its presets differ
 * from the default recipe's. `report`, when given, hears about a callout left off because it
 * does not fit its card even one stop down (the caller logs it).
 */
export function materialiseSlide(
  spec: SlideSpec,
  themeId: string,
  meta: MaterialiseMeta,
  ids: IdSupplier = uid,
  variant?: number | string,
  structure: SlideStructure = {},
  report?: (note: string) => void,
): Slide {
  return materialisePages(spec, themeId, meta, ids, variant, structure, false, report)[0] as Slide;
}

/**
 * `materialiseSlide` as every slide the words need, for generation (UX ruling 91): a teaching
 * slide whose text does not fit at or above the body floor continues on the next slide, split at a
 * sentence (a list after its lead and first points), its heading marked "(continued)". The notes
 * stay on the first slide; every slide carries the spec's fact references. Any other kind is the
 * one slide `materialiseSlide` makes.
 */
export function materialiseSlides(
  spec: SlideSpec,
  themeId: string,
  meta: MaterialiseMeta,
  ids: IdSupplier = uid,
  variant?: number | string,
  structure: SlideStructure = {},
  report?: (note: string) => void,
): Slide[] {
  return materialisePages(
    spec,
    themeId,
    meta,
    ids,
    variant,
    structure,
    spec.kind === "content",
    report,
  );
}

function materialisePages(
  spec: SlideSpec,
  themeId: string,
  meta: MaterialiseMeta,
  ids: IdSupplier,
  variant: number | string | undefined,
  structure: SlideStructure,
  pages: boolean,
  report?: (note: string) => void,
): Slide[] {
  // The shape the writer filled wins over what the words suggest (`content-shapes.ts`).
  structure = withShapeHints(spec, structure);
  // A slide with a diagram instruction is always laid out `headed`: the slot takes the right half,
  // which a two-column body or a statement would leave no room for (GENERATION-RESULTS finding 3).
  // A compare or a sequence takes the full measure, so it has no half to give a diagram. A shape
  // the writer filled (compare, steps, points) is placed under the heading too. Any other slide
  // left without a variant takes the kind's default, or a diagram its Figure template's.
  const photo = spec.kind === "content" ? photoOf(spec, structure) : undefined;
  let chosen = variant ?? defaultVariant(spec);
  if (spec.kind === "content" && (diagramOf(spec) || photo || shapeOf(spec) !== "explain")) {
    chosen = "headed";
  }
  const laid = reid(layoutSlide(spec.kind, themeId, chosen), ids);
  const filled = fillSlide(spec, themeId, laid, ids, chosen);
  const stamp = provenance(spec.factRefs, meta);
  let slide: Slide = { id: ids(), kind: spec.kind, elements: filled.elements };
  const diagram = spec.kind === "content" ? diagramOf(spec) : undefined;
  // A photograph the plan asked for keeps the right half (look/image-slot), with pages too: the
  // words sit beside it at the body size and continue on the next slide rather than shrink it.
  if (photo && variantName(spec.kind, chosen) === "headed") {
    slide = withPhotoSlot(slide, getTheme(themeId), photo, ids);
  }
  // With pages (generation), an undrawn diagram does not shape the text: the words are laid out
  // as if it were not there, and the instruction rides on the first slide as `slide.diagram`, which
  // the editor shows beside the canvas. TODO(diagram PR): relay the slide around a real drawing.
  if (diagram && !photo && !pages && variantName(spec.kind, chosen) === "headed") {
    slide = withDiagramSlot(slide, getTheme(themeId), diagram, ids);
  }
  if (filled.question) slide.question = filled.question;
  if (spec.notes) slide.notes = spec.notes;
  // The recipe is sized for its placeholder copy; fit it to the real copy before it is stored.
  const fitted = lookAndFitPages(slide, getTheme(themeId), ids, structure, { pages });
  const noted =
    diagram && pages
      ? fitted.map((page, i) => (i === 0 ? { ...page, diagram: { instruction: diagram } } : page))
      : fitted;
  const out = pages ? noted : noted.slice(0, 1);
  // A callout too long for its card even one stop down, or with no room left under the words
  // beside a slot, is left off, never clipped (rulings 91, 102); the worked example's is left
  // off by design (`applyCallout`) and is not reported.
  if (
    report &&
    (spec.kind === "content" || spec.kind === "image-text") &&
    spec.callout &&
    !out.some((page) => page.elements.some(isCalloutElement))
  ) {
    report(
      `callout dropped: ${spec.callout.text.length} characters of ${spec.callout.kind} do not fit the room the ${spec.kind} slide leaves at the small floor`,
    );
  }
  return out.map((page) => ({
    ...page,
    elements: page.elements.map((element) => stampElement(element, stamp)),
  }));
}

/**
 * The lesson look (`look.ts`), the structured components (`structure.ts`), then the fit, as every
 * page the slide needs: a question set too long for one slide at the body size continues on the
 * next (UX ruling 91). A teaching slide whose lead and card still overrun at the floor is set as
 * one paragraph instead, which keeps the room the card's inset would take; whatever overruns then
 * is the fit engine's to report or carry over.
 */
export function lookAndFitPages(
  slide: Slide,
  theme: Theme,
  ids: IdSupplier = uid,
  structure: SlideStructure = {},
  options: { pages?: boolean } = { pages: true },
): Slide[] {
  // A teaching slide's callout sits out the look and the structure pass, which re-lay the words
  // from the top and know nothing of a card at the foot; it goes back under the words after.
  if (slide.kind === "content") {
    const detached = detachCallout(slide);
    if (detached.callout) {
      const pages = lookAndFitPages(detached.slide, theme, ids, structure, options);
      const at = pages.length - 1;
      const last = pages[at] as Slide;
      const placed = placeCallout(last, theme, detached.callout, ids);
      if (placed) return pages.map((page, i) => (i === at ? placed : page));
      // The callout is secondary (rulings 102, 106): the words keep the size and shape they
      // have without it, and a card with no room even one stop down is left off and reported.
      return pages;
    }
  }
  // The structure pass places its components under the heading as the fit sets it, so it runs on
  // the fitted look.
  const looked = fitSlide(applyLook(slide, theme, ids), theme).slide;
  const pages = structureSlide(looked, theme, structure, ids, options);
  const done = pages.flatMap((page) => {
    const looked = fitSlide(page, theme);
    const split = looked.slide.elements.some((e) => e.name === KEY_IDEA_NAME);
    if (!split || looked.overflow.length === 0) return [looked.slide];
    const paragraph = fitSlide(
      withTerms(applyLook(slide, theme, ids, { lead: false }), theme, structure.terms),
      theme,
    ).slide;
    // With pages, a paragraph that still overruns at the floor continues (UX ruling 91).
    return options.pages === false || pages.length > 1
      ? [paragraph]
      : continueParagraph(paragraph, theme, ids, structure.terms).map(
          (p) => fitSlide(p, theme).slide,
        );
  });
  return done;
}

/**
 * `lookAndFitPages` for one slide (a generated slide is one slide): a set that would need a second
 * keeps its list, its answers on the panel, for the editor's Tidy to continue (UX ruling 91).
 */
export function lookAndFit(
  slide: Slide,
  theme: Theme,
  ids: IdSupplier = uid,
  structure: SlideStructure = {},
): Slide {
  return lookAndFitPages(slide, theme, ids, structure, { pages: false })[0] as Slide;
}

/**
 * A teaching slide with a diagram instruction and no drawing, or a photo slot no photograph
 * filled, as a class sees it (present, the viewer, export, print). The slot is a note to the
 * teacher that only the editor draws, so there it would leave the right half empty: the words are
 * laid out again as if the slide had no slot, a key idea on the right panel when they carry one,
 * else across the full measure. The top line and counter are kept as they were. A slide without
 * an open slot (a placed photograph is not one) comes back as it is (same object).
 */
export function withoutDiagramSlot(slide: Slide, theme: Theme): Slide {
  if (
    slide.kind !== "content" ||
    !slide.elements.some((e) => e.name === DIAGRAM_NAME || isOpenPhotoSlot(e))
  ) {
    return slide;
  }
  // Should the words not lay out again, they stay as stored and only the slot is taken away.
  const unslotted = {
    ...slide,
    elements: slide.elements.filter((e) => !isDiagramMark(e) && !isOpenPhotoSlot(e)),
  };
  return relaid(slide, theme, (bare) => bare, unslotted);
}

/**
 * The demo and screenshot view (look/image-slot; off by default, never in production): every slot
 * a slide should have is drawn where it goes, with what the model asked for in small muted type.
 * An open photo slot is left as it is (the image view draws its placeholder); an undrawn diagram
 * (`slide.diagram`, which takes no room at generation) is given the right half, the words laid
 * out beside it and "Diagram: <instruction>" in it, which the renderer draws as the same
 * placeholder as a photo's (`@tj/editor` `SlotPlaceholder`). Any other slide comes back as it is
 * (same object).
 */
export function withSlotsShown(slide: Slide, theme: Theme): Slide {
  const instruction = slide.diagram?.instruction;
  const hasSlot = slide.elements.some((e) => e.name === DIAGRAM_NAME || e.name === PHOTO_NAME);
  let shown = slide;
  if (slide.kind === "content" && instruction && !hasSlot) {
    shown = relaid(
      slide,
      theme,
      (bare, ids) => withDiagramSlot(bare, theme, instruction, ids, `Diagram: ${instruction}`),
      slide,
    );
  }
  return shown;
}

/**
 * A content slide's words laid out again from one body, as the writer gave them: the open slots
 * and their dots taken away, `shape` given the bare slide (to add a slot back, or not), then the
 * look and the fit. The top line and counter are kept as they were.
 */
function relaid(
  slide: Slide,
  theme: Theme,
  shape: (bare: Slide, ids: IdSupplier) => Slide,
  fallback: Slide,
): Slide {
  const heading = slide.elements.find((e) => e.name === HEADING_NAME);
  const column = new Set([LEAD_NAME, ITEM_NAME, BODY_NAME, KEY_IDEA_NAME]);
  const words = slide.elements
    .filter(
      (e): e is TextElement =>
        e.type === "text" &&
        e.style.preset === "body" &&
        (!e.name || column.has(e.name)) &&
        e.y >= (heading ? heading.y + heading.h : 0),
    )
    .sort((a, b) => a.y - b.y || a.x - b.x);
  // A key idea set on the side panel is the writer's first sentence: it leads the words again.
  // The panel's card, label and a glossary definition (not the writer's words) go with it.
  const idea = slide.elements.find(
    (e): e is TextElement => e.type === "text" && e.name === PANEL_TEXT_NAME,
  );
  const card = slide.elements.find((e) => e.name === PANEL_NAME);
  if (idea)
    words.unshift({ ...idea, y: Math.min(card?.y ?? idea.y, idea.y), style: { preset: "body" } });
  const panel = new Set([PANEL_NAME, PANEL_LABEL_NAME, PANEL_TEXT_NAME, PANEL_DEFINITION_NAME]);
  const first = words[0];
  const dropped = new Set<SlideElement>(words);
  for (const e of slide.elements) {
    if (
      panel.has(e.name ?? "") ||
      e.name === DIAGRAM_NAME ||
      e.name === BULLET_NAME ||
      isOpenPhotoSlot(e)
    ) {
      dropped.add(e);
    }
  }
  // Nothing to lay out again (no heading, or no words under it): the caller's fallback, the slide
  // with its words as stored, never one with its words taken away and none put back.
  if (!heading || !first) return fallback;
  const kept = slide.elements.filter((e) => !dropped.has(e));
  // One body again, as the writer gave it: the paragraphs, then the points as a bullet list.
  const content: RichNode[] = [];
  let list: RichNode | undefined;
  for (const e of words) {
    if (e.name === ITEM_NAME) {
      list ??= { type: "bulletList", content: [] };
      list.content?.push({ type: "listItem", content: e.doc.content ?? [] });
      continue;
    }
    if (list) content.push(list);
    list = undefined;
    content.push(...(e.doc.content ?? []));
  }
  if (list) content.push(list);
  let n = 0;
  const ids = () => `${slide.id}~${++n}`;
  const { name: _name, ...rest } = first;
  const body: TextElement = {
    ...rest,
    id: ids(),
    x: SAFE.x,
    w: SAFE.w,
    doc: { type: "doc", content },
    style: { preset: "body" },
  };
  // The kind tag as it was.
  const chrome = slide.elements.filter((e) => e.name === KIND_TAG_NAME);
  const bare = stripLook({ ...slide, elements: [...kept, body] });
  const laid = lookAndFit(shape(bare, ids), theme, ids, { terms: markedTerms(words) });
  // Every word the slide said must still be said: a relayout that would drop one (a lone point
  // carried to a page this view does not draw) gives way to the caller's fallback.
  if (!says(laid.elements, words)) return fallback;
  const had = new Set(chrome.map((e) => e.name));
  return { ...laid, elements: [...laid.elements.filter((e) => !had.has(e.name)), ...chrome] };
}

/** The words of `els`, as a count per lower-cased word. */
function wordCounts(els: readonly SlideElement[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of els) {
    if (e.type !== "text") continue;
    for (const w of richDocToPlainText(e.doc)
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [])
      counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return counts;
}

/** Whether `laid` says every word of `words`, as often as they do. */
function says(laid: readonly SlideElement[], words: readonly SlideElement[]): boolean {
  const have = wordCounts(laid);
  for (const [w, n] of wordCounts(words)) if ((have.get(w) ?? 0) < n) return false;
  return true;
}

/**
 * A slide as a class sees it, for a renderer that draws `slide.elements` itself (the PPTX export):
 * the diagram slot laid out away (`withoutDiagramSlot`). `SlideView` does the same outside the
 * editor.
 */
export function presentedSlide(slide: Slide, theme: Theme): Slide {
  const shown = withoutDiagramSlot(slide, theme);
  const elements = shown.elements.filter((e) => !isDiagramMark(e) && !isOpenPhotoSlot(e));
  return { ...shown, elements };
}

/** The key terms a slide's running text picks out (bold), so the relaid words mark them again. */
function markedTerms(els: TextElement[]): string[] {
  const out = new Set<string>();
  const walk = (nodes: RichNode[] | undefined) => {
    for (const node of nodes ?? []) {
      if (node.type === "text" && node.marks?.some((m) => m.type === "bold") && node.text) {
        out.add(node.text.trim());
      }
      walk(node.content);
    }
  };
  for (const e of els) walk(e.doc.content);
  return [...out].filter(Boolean);
}

/**
 * The variant a spec is laid out in when the caller gives none: the kind's default, except a
 * diagram, whose Figure template picks it (`diagramVariantFor`, ADR 0034 decision 7).
 */
function defaultVariant(spec: SlideSpec): number | string {
  if (spec.kind === "title" && spec.objectives?.length) return "agenda";
  return spec.kind === "diagram" ? diagramVariantFor(spec.figure.template, spec.figure.values) : 0;
}

type Layout = { elements: SlideElement[]; question?: QuestionData };

type ContentSpec = SlideSpecOf<"content">;

/** The diagram a content slide keeps room for: none beside a compare or a sequence. */
const diagramOf = (spec: ContentSpec) =>
  spec.compare || spec.steps?.length ? undefined : spec.diagram;

/**
 * The photograph a content slide keeps room for (`SlideStructure.photo`): an explain or a list
 * only. A compare or a sequence takes the full measure, so its photograph is dropped (the caller
 * logs it, `photoDropped`).
 */
const photoOf = (spec: ContentSpec, structure: SlideStructure) =>
  structure.photo && !photoDropped(spec, structure) ? structure.photo : undefined;

/** A photo brief a content spec's shape has no room for: a compare or a sequence is full width. */
export function photoDropped(
  spec: SlideSpec,
  structure: Pick<SlideStructure, "photo">,
): ContentShape | undefined {
  if (spec.kind !== "content" || !structure.photo) return undefined;
  const shape = shapeOf(spec);
  return shape === "compare" || shape === "sequence" ? shape : undefined;
}

/**
 * A content spec's explicit shape fields as structure hints (`content-shapes.ts`): `compare` is
 * the compare cards, `steps` the steps strip, `points` a lead with dot points under it. A field
 * always wins over what the words suggest and over a hint the caller inferred; a spec without
 * one keeps `inferStructure` as its fallback, as a stored lesson does.
 */
export function withShapeHints(spec: SlideSpec, structure: SlideStructure = {}): SlideStructure {
  if (spec.kind !== "content") return structure;
  const { compare: _c, sequence: _s, keyCard: _k, points: _p, ...rest } = structure;
  if (spec.compare) {
    const { left, right } = spec.compare;
    return {
      ...rest,
      compare: {
        left: { label: left.label, points: left.points },
        right: { label: right.label, points: right.points },
      },
    };
  }
  if (spec.steps?.length) return { ...rest, sequence: spec.steps };
  if (spec.points?.length) return { ...rest, points: spec.points };
  return structure;
}

/**
 * The shape a content spec was written in when the slide could not place it as written: a compare
 * without its cards, a sequence without its strip, a list without its dot points. The slide then
 * reads as the lead plus points (`shapeFallbackPoints`), or the fit carries it on (UX ruling 91).
 * `undefined` when the shape was placed, or the spec names none. A word budget missed this way
 * is a metric, not a retry: Generate logs it (`shape fallback`) by shape.
 */
export function shapeFallback(spec: SlideSpec, slide: Slide): ContentShape | undefined {
  if (spec.kind !== "content") return undefined;
  const shape = shapeOf(spec);
  const has = (name: string) => slide.elements.some((e) => e.name === name);
  if (shape === "compare" && !has(COMPARE_NAME)) return shape;
  if (shape === "sequence" && !has(STEP_NAME)) return shape;
  if (shape === "list" && !has(ITEM_NAME)) return shape;
  return undefined;
}

/**
 * What a compare or a sequence reads as when its cards cannot be placed: the lead plus dot points
 * (`structure.ts` falls back to it), so no line of the spec is lost with the component.
 */
export function shapeFallbackPoints(spec: ContentSpec): string[] | undefined {
  if (spec.compare) {
    return [spec.compare.left, spec.compare.right].map(
      (side) => `${side.label}: ${side.points.join("; ")}`,
    );
  }
  if (spec.steps?.length) return spec.steps;
  return spec.points;
}

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
      return fillContent(spec, themeId, laid, ids, variantName(spec.kind, variant));
    case "image-text":
      return fillImageText(spec, themeId, laid, ids);
    case "diagram":
      return fillDiagram(spec, themeId, laid, ids);
    case "worked-example":
      return fillWorkedExample(spec, themeId, laid, ids);
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
  if (variant === "agenda") {
    // The title at the heading stop and the class line in `small`, named (`layouts.ts`); the
    // objectives under the stem, lower-cased as the objectives slide sets them.
    setText(slot(laid, "Title"), spec.title);
    setText(slot(laid, "Subtitle"), spec.subtitle);
    setText(slot(laid, AGENDA_STEM), OBJECTIVES_SLIDE_HEADING);
    setDoc(
      slot(laid, AGENDA_OBJECTIVES),
      docFromNumbered((spec.objectives ?? []).map(objectiveLine)),
    );
    return laid;
  }
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
  return withFootnote(laid, "footnote" in spec ? spec.footnote : undefined);
}

/**
 * The recipe's `small` text is a sample footnote ("5 minutes. Work in silence…"). A spec that
 * gives one replaces it; a spec that gives none loses the element, so no sample text reaches a
 * pupil (TEACH-243: a pair task went out over "Work in silence and answer in your book").
 */
function withFootnote(laid: Layout, footnote: string | undefined): Layout {
  if (footnote) {
    setText(textOf(laid, "small"), footnote);
    return laid;
  }
  return {
    ...laid,
    elements: laid.elements.filter(
      (element) => !(element.type === "text" && element.style.preset === "small"),
    ),
  };
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

function fillContent(
  spec: ContentSpec,
  themeId: string,
  laid: Layout,
  ids: IdSupplier,
  variant: ContentVariant,
): Layout {
  const points = shapeFallbackPoints(spec);
  if (variant === "statement") {
    // No heading on a statement: the heading becomes the eyebrow over the sentence.
    setText(slot(laid, "Eyebrow"), spec.heading);
    setDoc(slot(laid, "Statement"), bodyWithPoints(spec.body, points));
    return withCallout(spec, themeId, laid, ids, variant);
  }
  setText(textOf(laid, "heading"), spec.heading);
  if (variant === "callout-row") {
    // One sentence, hugged by its box: the row under it takes every point the words leave.
    const idea = slot(laid, IDEA_NAME);
    setText(idea, spec.body);
    const measured = measureHeadless(getTheme(themeId))({
      doc: idea.doc,
      width: idea.w,
      style: idea.style,
      preset: "body",
      inset: 0,
      chrome: 0,
    });
    idea.h = Math.ceil(measured);
    return withCallout(spec, themeId, laid, ids, variant);
  }
  if (variant === "two-column") {
    const [left, right] = splitAtFullStop(spec.body);
    setText(slot(laid, "Body left"), left);
    const rightSlot = slot(laid, "Body right");
    if (right || points?.length) {
      setDoc(rightSlot, bodyWithPoints(right, points));
      return withCallout(spec, themeId, laid, ids, variant);
    }
    // One sentence with no full stop to split at: the left column carries it all.
    return withCallout(
      spec,
      themeId,
      { ...laid, elements: laid.elements.filter((element) => element !== rightSlot) },
      ids,
      variant,
    );
  }
  setDoc(textOf(laid, "body"), bodyWithPoints(spec.body, points));
  return withCallout(spec, themeId, laid, ids, variant);
}

/**
 * The labelled card under the body (UX ruling 84, TEACH-75) when the spec carries one; a spec
 * without one leaves the recipe untouched, so every layout snapshot holds. The four are minted
 * after `reid`, so its ids come from `ids` here for the same determinism as the recipe's.
 */
function withCallout(
  spec: SlideSpecOf<"content" | "image-text" | "worked-example">,
  themeId: string,
  laid: Layout,
  ids: IdSupplier,
  variant = "",
): Layout {
  if (!spec.callout) return laid;
  const before = new Set(laid.elements);
  const withCard = applyCallout(laid, getTheme(themeId), spec.kind, variant, spec.callout);
  return {
    ...withCard,
    elements: withCard.elements.map((element) =>
      before.has(element) ? element : { ...element, id: ids() },
    ),
  };
}

/**
 * A content body and its optional `points`: the body's paragraphs, then the points as one bullet
 * list. The look (`leadAndCard`) keeps the first sentence as the lead and puts the rest, list
 * included, under it.
 */
export function bodyWithPoints(body: string, points: string[] | undefined): RichDoc {
  if (!points?.length) return docFromText(body);
  const text = body.trim() ? (docFromText(body).content ?? []) : [];
  return { type: "doc", content: [...text, ...(docFromBullets(points).content ?? [])] };
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

function fillImageText(
  spec: SlideSpecOf<"image-text">,
  themeId: string,
  laid: Layout,
  ids: IdSupplier,
): Layout {
  // The recipe's caption is "KEY IDEA"; a picture slide that asks pupils to look says so (TEACH-243).
  if (spec.caption) setText(textOf(laid, "caption"), spec.caption);
  setText(textOf(laid, "heading"), spec.heading);
  setText(textOf(laid, "body"), spec.body);
  // The image slot stays as the recipe made it: PLACEHOLDER_IMAGE until `illustrate` places a
  // photograph (or leaves it, with a warning finding, when Pexels has nothing).
  return withCallout(spec, themeId, laid, ids);
}

/**
 * The text as `image-text` fills it, and the figure drawn from the spec's values where the
 * recipe's placeholder figure is (ADR 0032, TEACH-89). The model never places the figure; the
 * drawing's ids come from the same supplier as the rest of the slide.
 */
function fillDiagram(
  spec: SlideSpecOf<"diagram">,
  themeId: string,
  laid: Layout,
  ids: IdSupplier,
): Layout {
  if (spec.caption) setText(textOf(laid, "caption"), spec.caption);
  setText(textOf(laid, "heading"), spec.heading);
  setText(textOf(laid, "body"), spec.body);
  const placeholder = figureGroupOf(laid);
  if (!placeholder) throw new Error("recipe has no figure group");
  const { x, y, w, h } = placeholder;
  const drawn = drawFigure(spec.figure.template, spec.figure.values, getTheme(themeId), {
    x,
    y,
    w,
    h,
  });
  const [figure] = reid({ elements: [drawn] }, ids).elements;
  return {
    ...laid,
    elements: laid.elements.map((element) =>
      element === placeholder && figure ? figure : element,
    ),
  };
}

function fillWorkedExample(
  spec: SlideSpecOf<"worked-example">,
  themeId: string,
  laid: Layout,
  ids: IdSupplier,
): Layout {
  if (spec.heading) setText(textOf(laid, "heading"), spec.heading);
  const [question, working] = textsOf(laid, "body");
  setText(question, spec.question);
  setDoc(working, docFromNumbered(spec.steps));
  return withCallout(spec, themeId, laid, ids);
}

function fillDiscussion(spec: SlideSpecOf<"discussion">, laid: Layout): Layout {
  setText(textOf(laid, "subtitle"), spec.prompt);
  return withFootnote(laid, spec.footnote);
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
