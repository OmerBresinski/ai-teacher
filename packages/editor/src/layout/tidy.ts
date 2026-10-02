import {
  type Id,
  type Lesson,
  type RichDoc,
  type RichNode,
  SLIDE_W,
  type Slide,
  type SlideElement,
  type Theme,
} from "@tj/domain/documents";
import { BODY_Y, HEADING_GAP, KIND_TAG_NAME, SAFE, SPACE, snapY } from "@tj/slides";
import { cloneSlide, docFromText, uid } from "../model/factories";
import * as reducers from "../model/reducers";
import { getTheme } from "../model/themes";
import { docToPlainText } from "../text/static";
import { explanationReserve, hasExplanationPanel, reservedLines } from "./explanation";
import {
  docLineCount,
  isBackdrop,
  isFrozen,
  isHairline,
  isLayerBelow,
  isQuestionSlide,
  type MeasureInput,
  type Measurer,
  type ReflowResult,
  reflowSlide,
  SAFE_BOTTOM,
  SAFETY,
  splitDocToFit,
  textPartsOf,
} from "./reflow";

/**
 * Text fitting engine — the action (TeachDeck `lib/layout/tidy.ts`). `tidySlide` is what "Tidy
 * slide" runs: measure the slide for real, reflow it (`./reflow.ts`), and return the lesson with
 * the result applied. When the slide still will not fit at the smallest legible size, it splits
 * the offending list across a continuation slide of the same kind rather than shrinking past the
 * SPEC §7 floor.
 *
 * TeachDeck wrote the result into the store inside a transaction; here the function is pure given
 * the measurer — `(lesson, slideId, measure) → { lesson, outcome }` — and the caller dispatches it
 * as one reducer step (`tidySlideReducer`), so a tidy is one undo entry by construction.
 */

export type TidyOutcome = {
  moved: number;
  stepped: number;
  /** How many continuation slides the split created. */
  continued: number;
  /** Ids still overflowing after everything the engine could do. */
  overflow: Id[];
  /** The first words of each of those boxes, in `overflow` order, so the toast can name them. */
  overflowText?: string[];
  /** Ids still standing in the lane the "Why?" panel is owed. */
  laneOverflow: Id[];
  changed: boolean;
};

const EMPTY: TidyOutcome = {
  moved: 0,
  stepped: 0,
  continued: 0,
  overflow: [],
  laneOverflow: [],
  changed: false,
};

/** Sub-point noise from rounding is not a move. */
const EPS = 0.5;

/* ------------------------------------------------------------------ */
/* Splitting a lone paragraph at a sentence                            */
/* ------------------------------------------------------------------ */

/** Where a new sentence starts: after . ! ? (and any closing quote or bracket) and a space. */
const SENTENCE_START = /[.!?]["'\u201d\u2019)\]]*\s+/g;

const sentenceStarts = (text: string): number[] => {
  const out: number[] = [];
  for (const m of text.matchAll(SENTENCE_START)) {
    const at = (m.index ?? 0) + m[0].length;
    if (at < text.length) out.push(at);
  }
  return out;
};

/** A paragraph made of text runs only (marks allowed): the kind a sentence split can cut. */
const isPlainParagraph = (node: RichNode | undefined): node is RichNode =>
  node?.type === "paragraph" &&
  (node.content ?? []).every((n) => n.type === "text" && typeof n.text === "string");

const paragraphText = (p: RichNode): string => (p.content ?? []).map((n) => n.text ?? "").join("");

/** Cut a paragraph's text runs at `offset`, keeping each run's marks; no run is left empty. */
function cutParagraph(p: RichNode, offset: number): [RichNode, RichNode] {
  const head: RichNode[] = [];
  const tail: RichNode[] = [];
  let seen = 0;
  for (const run of p.content ?? []) {
    const text = run.text ?? "";
    const end = seen + text.length;
    if (end <= offset) head.push(run);
    else if (seen >= offset) tail.push(run);
    else {
      head.push({ ...run, text: text.slice(0, offset - seen) });
      tail.push({ ...run, text: text.slice(offset - seen) });
    }
    seen = end;
  }
  const last = head[head.length - 1];
  if (last) head[head.length - 1] = { ...last, text: (last.text ?? "").trimEnd() };
  const first = tail[0];
  if (first) tail[0] = { ...first, text: (first.text ?? "").trimStart() };
  const kept = (runs: RichNode[]) => runs.filter((r) => (r.text ?? "").length > 0);
  return [
    { ...p, content: kept(head) },
    { ...p, content: kept(tail) },
  ];
}

const docOfNode = (node: RichNode): RichDoc => ({ type: "doc", content: [node] });

/**
 * Split a doc that is one paragraph at the last sentence end that lets the head fit `room`. At
 * least one sentence stays. Null when there is no sentence end to cut at, or the paragraph is not
 * plain text runs.
 */
function splitParagraphToFit(
  doc: RichDoc,
  base: Omit<MeasureInput, "doc">,
  room: number,
  measure: Measurer,
): { head: RichDoc; tail: RichDoc } | null {
  const p = doc.content?.[0];
  if (!p || doc.content?.length !== 1 || !isPlainParagraph(p)) return null;
  const starts = sentenceStarts(paragraphText(p));
  if (starts.length === 0) return null;
  let fits = 0;
  for (let n = 1; n <= starts.length; n++) {
    const [head] = cutParagraph(p, starts[n - 1] ?? 0);
    if (measure({ ...base, doc: docOfNode(head) }) > room + EPS) break;
    fits = n;
  }
  const [head, tail] = cutParagraph(p, starts[Math.max(1, fits) - 1] ?? 0);
  return { head: docOfNode(head), tail: docOfNode(tail) };
}

/**
 * Split a doc so that its head fits `room`: on list items or blocks first and, when the head is
 * then one paragraph that still overruns, at a sentence end inside that paragraph.
 */
function splitToFit(
  doc: RichDoc,
  base: Omit<MeasureInput, "doc">,
  room: number,
  measure: Measurer,
): { head: RichDoc; tail: RichDoc | null } {
  const blocks =
    docLineCount(doc) > 1 ? splitDocToFit(doc, base, room, measure) : { head: doc, tail: null };
  if (docLineCount(blocks.head) === 1 && measure({ ...base, doc: blocks.head }) > room + EPS) {
    const bySentence = splitParagraphToFit(blocks.head, base, room, measure);
    if (bySentence) {
      const rest = blocks.tail?.content ?? [];
      return {
        head: bySentence.head,
        tail: { type: "doc", content: [...(bySentence.tail.content ?? []), ...rest] },
      };
    }
  }
  return blocks;
}

/** The doc an element carries, if it is one the engine can split: several items or blocks, or one paragraph of several sentences. */
function splittableDoc(el: SlideElement): RichDoc | null {
  if (el.type !== "text" && el.type !== "gap-text") return null;
  if (docLineCount(el.doc) > 1) return el.doc;
  const p = el.doc.content?.[0];
  return p && isPlainParagraph(p) && sentenceStarts(paragraphText(p)).length > 0 ? el.doc : null;
}

const isHeadingText = (el: SlideElement): boolean =>
  el.type === "text" && (el.style.preset === "heading" || el.style.preset === "title");

/** What every continuation keeps from its source: the backdrop, the heading and the rule under it. */
const isChrome = (el: SlideElement): boolean =>
  isBackdrop(el) || isHeadingText(el) || isHairline(el);

/**
 * A box that flows down the slide and can be carried onto a continuation. A card, an image or an
 * icon is not one: a card travels with the text that sits on it, an image stays where it was put.
 */
const isFlow = (el: SlideElement): boolean => !isChrome(el) && !isFrozen(el) && !isLayerBelow(el);

/** Reading order: top edge, then draw order. */
const byY = (a: { y: number; index: number }, b: { y: number; index: number }) =>
  a.y - b.y || a.index - b.index;

/**
 * Does `el` sit on `card`? Its top edge inside the card and its width within the card's: the
 * bottom is not checked, because editing rewrites an auto-height box's stored height to its
 * content, and a box a teacher has just typed into runs past the card it was laid on.
 */
const sitsOn = (card: SlideElement, el: SlideElement): boolean =>
  el.x >= card.x - EPS &&
  el.x + el.w <= card.x + card.w + EPS &&
  el.y >= card.y - EPS &&
  el.y < card.y + card.h - EPS;

/** The card an element sits on, if any: a layer below, not the backdrop. */
const cardOf = (el: SlideElement, authored: SlideElement[]): SlideElement | undefined =>
  authored.find((o) => o.id !== el.id && isLayerBelow(o) && !isBackdrop(o) && sitsOn(o, el));

/**
 * Where carried text starts on a continuation: the recipes' body top, or higher when the source
 * slide's own body starts higher (a title slide has no heading band to clear).
 */
const bodyTopOf = (authored: SlideElement[]): number => {
  const band = headerBand(authored);
  return Math.min(
    bodyFloorOf(authored),
    ...authored.filter((el) => isFlow(el) && !band.has(el.id)).map((el) => el.y),
  );
};

/**
 * Where a continuation's body can start at the highest: under its heading once the "CONTINUED"
 * label has pushed that heading down (`markContinued`), so every slide in the chain starts its body
 * at the same place. Beside a kind tag the label takes no room of its own.
 */
const bodyFloorOf = (authored: SlideElement[]): number => {
  if (!authored.some((el) => el.name === CONTINUED_LABEL)) return BODY_Y;
  if (authored.some((el) => el.name === KIND_TAG_NAME)) return BODY_Y;
  const heading = authored.find(isHeadingText);
  return heading ? Math.max(BODY_Y, snapY(heading.y + heading.h + HEADING_GAP)) : BODY_Y;
};

/**
 * The slide's frame, which every continuation keeps as it stands: what sits wholly above the
 * heading (a generated slide's kind tag and deck line) and a locked bar across the slide's width
 * (its accent bar). Without it a generated slide's continuation lost its frame and started its body
 * in the header band, above the heading.
 */
function headerBand(authored: SlideElement[]): Set<Id> {
  const heading = authored.find(isHeadingText);
  return new Set(
    authored
      .filter(
        (el) =>
          el !== heading &&
          !isChrome(el) &&
          ((heading && el.type === "text" && el.y + el.h <= heading.y + EPS) ||
            (el.type === "shape" && !!el.locked && el.w >= SLIDE_W - 1)),
      )
      .map((el) => el.id),
  );
}

/** The small "CONTINUED" label a continuation carries above its heading (TEACH-248). */
export const CONTINUED_LABEL = "Continued label";

/**
 * Mark a continuation slide as a second page (TEACH-248, variant B): the heading keeps its words
 * and its size, and a small "CONTINUED" label in the kind tag's style sits above it. Only the
 * heading's first line is kept: lines a teacher typed into the heading box stay on the slide they
 * typed them on, and are not repeated over every continuation.
 *
 * Beside a kind tag the label shares the tag's line. Without one it takes the top of the safe
 * area, where a heading stands on an ordinary slide, and the heading moves down to clear it. The
 * rule under the heading follows it; the body moves only when the heading's new foot would crowd it
 * (a card keeps its bottom edge). What then does not fit goes on to the next continuation.
 */
function markContinued(slide: Slide, theme: Theme): void {
  const heading = slide.elements.find(isHeadingText);
  if (heading?.type !== "text") return;
  const first = heading.doc.content?.[0];
  const text = docToPlainText(first ?? heading.doc).trim();
  if (!text) return;
  heading.doc = docFromText(text);
  // A continuation of a continuation carries the label (and the lowered heading) in its frame.
  if (slide.elements.some((e) => e.name === CONTINUED_LABEL)) return;
  const tag = slide.elements.find((e) => e.name === KIND_TAG_NAME && e.type === "text");
  if (tag?.type === "text") {
    slide.elements.push({
      ...structuredClone(tag),
      id: uid(),
      name: CONTINUED_LABEL,
      x: tag.x + tag.w + 8,
      w: 150,
      doc: docFromText("CONTINUED"),
    });
    return;
  }
  const top = Math.min(heading.y, SAFE.y);
  const labelH = Math.ceil(theme.sizes.caption * theme.lineHeights.caption);
  const drop = Math.max(0, snapY(top + labelH + SPACE[2]) - heading.y);
  if (drop > 0) {
    const oldFoot = heading.y + heading.h;
    heading.y += drop;
    const foot = heading.y + heading.h;
    const below = slide.elements.filter(
      (el) => el !== heading && !isBackdrop(el) && el.y >= oldFoot - EPS,
    );
    // The body moves only if the heading's new foot reaches into the gap it keeps on an ordinary
    // slide, and a card keeps its bottom edge. The rule under the heading then takes the middle of
    // the band between them.
    const body = below.filter((el) => !isHairline(el));
    const firstBody = Math.min(...body.map((el) => el.y), Number.POSITIVE_INFINITY);
    const shift = Number.isFinite(firstBody)
      ? Math.max(0, snapY(foot + HEADING_GAP) - firstBody)
      : 0;
    for (const el of body) {
      el.y += shift;
      if (isLayerBelow(el)) el.h = Math.max(1, el.h - shift);
    }
    const ruleY = Number.isFinite(firstBody)
      ? snapY((foot + firstBody + shift) / 2)
      : snapY(foot + SPACE[1]);
    for (const el of below) if (isHairline(el) && el.y < ruleY) el.y = ruleY;
  }
  slide.elements.push({
    id: uid(),
    type: "text",
    name: CONTINUED_LABEL,
    x: heading.x,
    y: top,
    w: 150,
    h: labelH,
    doc: docFromText("CONTINUED"),
    style: {
      preset: "caption",
      fontWeight: 700,
      color: theme.colors.accent,
      autoHeight: false,
    },
  });
}

/**
 * The floor the fit test works to: a true-false or multiple-choice slide owes a lane at the foot of
 * the safe area to its "Why?" panel, so the engine keeps that lane clear.
 */
const reflowOptions = (slide: Slide, theme: Theme, measure: Measurer) =>
  hasExplanationPanel(slide.question)
    ? { fitBottom: SAFE_BOTTOM - explanationReserve(theme, reservedLines(slide, theme, measure)) }
    : {};

/**
 * Lift a slide's body back to the top. A slide that overflows with a gap above its first box (a
 * generated layout that put the paragraph low, or a head slide whose lines have just gone to a
 * continuation) gains that room first: everything below the heading band moves up together, and
 * the next reflow pushes down whatever now meets the heading. Null when the body already starts
 * at the top.
 */
function restack(slide: Slide, reflowed: SlideElement[]): SlideElement[] | null {
  const bodyTop = bodyTopOf(slide.elements);
  const movable = (el: SlideElement) =>
    !isFrozen(el) &&
    !isBackdrop(el) &&
    !isHeadingText(el) &&
    !(isHairline(el) && el.y <= bodyTop + EPS);
  const tops = reflowed.filter((el) => movable(el) && !isHairline(el)).map((el) => el.y);
  if (tops.length === 0) return null;
  const shift = bodyTop - Math.min(...tops);
  if (shift >= -EPS) return null;
  return reflowed.map((el) => (movable(el) ? { ...el, y: el.y + shift } : el));
}

/**
 * One heading size for the whole chain: the smallest any slide in it needed, so a continuation
 * never shouts louder than its head or its neighbours.
 */
function levelHeadings(slides: Slide[], theme: Theme, measure: Measurer): Slide[] {
  const sizeOfHeading = (el: SlideElement) =>
    el.type === "text" ? (el.style.fontSize ?? theme.sizes[el.style.preset]) : Number.NaN;
  const sizes = slides
    .map((s) => s.elements.find(isHeadingText))
    .filter((el): el is SlideElement => !!el)
    .map(sizeOfHeading);
  if (sizes.length < 2) return slides;
  const size = Math.min(...sizes);
  return slides.map((s) => ({
    ...s,
    elements: s.elements.map((el) => {
      if (el.type !== "text" || !isHeadingText(el) || sizeOfHeading(el) === size) return el;
      const next = { ...el, style: { ...el.style, fontSize: size } };
      const parts = textPartsOf(next);
      if (parts?.autoHeight)
        next.h = Math.max(
          1,
          Math.round(
            measure({
              doc: parts.doc,
              width: next.w,
              style: parts.style,
              preset: parts.preset,
              role: parts.role,
              fontSize: size,
              inset: parts.inset,
              chrome: parts.chrome,
            }),
          ),
        );
      return next;
    }),
  }));
}

/**
 * The carried text boxes that take the full safe width on a continuation (ruling 102, T18-6): the
 * picture or column they stood beside stays behind, so they would otherwise wrap early. A box that
 * shares its row with another carried box (side-by-side columns) keeps its width, and so does
 * anything on a card, which the caller leaves out of `carried`.
 */
function fullWidth(carried: SlideElement[]): Set<Id> {
  const sharesRow = (a: SlideElement) =>
    carried.some(
      (b) =>
        b.id !== a.id &&
        a.y < b.y + b.h - EPS &&
        b.y < a.y + a.h - EPS &&
        (a.x + a.w <= b.x + EPS || b.x + b.w <= a.x + EPS),
    );
  return new Set(
    carried
      .filter((c) => (c.type === "text" || c.type === "gap-text") && !sharesRow(c))
      .filter((c) => c.x > SAFE.x + EPS || c.w < SAFE.w - EPS)
      .map((c) => c.id),
  );
}

/** Set a carried box across the safe width, re-measuring an auto-height box at its new width. */
function widen(el: SlideElement, slide: Slide, measure: Measurer): void {
  el.x = SAFE.x;
  el.w = SAFE.w;
  const parts = textPartsOf(el, slide);
  if (!parts?.autoHeight) return;
  el.h = Math.max(
    1,
    Math.round(
      measure({
        doc: parts.doc,
        width: el.w,
        style: parts.style,
        preset: parts.preset,
        role: parts.role,
        fontSize: parts.style?.fontSize,
        inset: parts.inset,
        chrome: parts.chrome,
      }),
    ),
  );
}

type Plan = {
  /** The head slide's elements once the overspill has gone: shortened, or with boxes removed. */
  head: SlideElement[];
  continuation: Slide;
};

type Candidate = { el: SlideElement; index: number; y: number };

/**
 * Build the continuation for one target box. `split` leaves the head of the box's doc behind and
 * carries the tail; `move` carries the whole box. Either way every flow element below the target
 * comes along, re-stacked from the body top under the source's heading (marked continued), its
 * backdrop and heading rule; the boxes that were fully placed above the target stay behind. A
 * target that sits on a card brings the card and what else is on it (a worked example's Working
 * card and its WORKING caption), and the card grows to fill the room it now has.
 */
function buildPlan(
  slide: Slide,
  reflowed: SlideElement[],
  order: Candidate[],
  target: Candidate,
  mode: "split" | "move",
  theme: Theme,
  measure: Measurer,
): Plan | null {
  const el = target.el;
  const authored = slide.elements;
  const src = authored[target.index] ?? el;
  const bodyTop = bodyTopOf(authored);
  const band = headerBand(authored);

  const card = cardOf(src, authored);
  const reflowedCard = card ? reflowed.find((r) => r.id === card.id) : undefined;
  // A card keeps its bottom edge: pushed down by what is above it, it gives up height rather than
  // running off the slide (the recipes stop it short of the safe edge by the engine's cushion).
  const cardFit = (y: number, bottom: number) =>
    Math.max(1, Math.floor(Math.min(bottom - y, (SAFE_BOTTOM - y) / (1 + SAFETY))));
  const cardBottom = card ? Math.min(card.y + card.h, SAFE_BOTTOM) : SAFE_BOTTOM;
  const group = new Set<Id>();
  if (card) {
    group.add(card.id);
    for (const o of authored) if (o.id !== card.id && sitsOn(card, o)) group.add(o.id);
  }

  const after = order.filter((c) => isFlow(c.el) && byY(c, target) > 0);
  const moving = new Set<Id>([el.id, ...after.map((c) => c.el.id)]);
  const wide = fullWidth([el, ...after.map((c) => c.el)].filter((r) => !group.has(r.id)));

  let headDoc: RichDoc | null = null;
  let tail: RichDoc | null = null;
  let tailH = el.h;
  if (mode === "split") {
    const doc = splittableDoc(el);
    const parts = doc ? textPartsOf(el, slide) : null;
    if (!doc || !parts) return null;
    const base = {
      width: el.w,
      style: parts.style,
      preset: parts.preset,
      // The size the layout settled on, so the split measures what the slide shows.
      fontSize: parts.style?.fontSize,
      inset: parts.inset,
      chrome: parts.chrome,
    };
    // The room on this slide, from where the box landed after the push and step-down; on a card,
    // to the card's own foot.
    const limit =
      card && reflowedCard
        ? Math.min(
            SAFE_BOTTOM,
            reflowedCard.y + cardFit(reflowedCard.y, cardBottom) - (src.x - card.x),
          )
        : SAFE_BOTTOM;
    const available = Math.max(parts.chrome + 1, limit - el.y);
    // The engine's 4% cushion applies to a box's own height against the safe edge; a card's foot
    // is already inside that edge by more than the cushion, so text on a card fills to the foot.
    const room = card ? available : available / (1 + SAFETY);
    const split = splitToFit(doc, base, room, measure);
    if (!split.tail) return null;
    // When not even the first line fits where the box stands, the box goes whole, and a card it
    // sits on goes with it rather than staying behind empty. If moving it gains nothing, the first
    // line stays here and is reported.
    if (measure({ ...base, doc: split.head }) > room + EPS) {
      const moved = buildPlan(slide, reflowed, order, target, "move", theme, measure);
      if (moved) return moved;
    }
    headDoc = split.head;
    tail = split.tail;
    // Measured at the width the tail will have on the continuation.
    const width = wide.has(el.id) ? SAFE.w : el.w;
    tailH = Math.max(1, Math.round(measure({ ...base, width, doc: tail })));
  } else if (wide.has(el.id)) {
    const widened = structuredClone(el);
    widen(widened, slide, measure);
    tailH = widened.h;
  }
  const shift = reflowedCard ? bodyTop - reflowedCard.y : bodyTop - el.y;
  // Boxes under a target that is shorter on the continuation (its tail, or the box set wider)
  // close up beneath it.
  const trailing = !card ? tailH - el.h : 0;

  const elements: SlideElement[] = [];
  let targetIdx = -1;
  reflowed.forEach((r, i) => {
    const a = authored[i] ?? r;
    if (band.has(a.id)) {
      elements.push(structuredClone(r));
      return;
    }
    if (isChrome(a)) {
      // As it stands on this slide, size included, so the chain's headings match. A rule below
      // the body top belongs to the content it sat under, not the heading.
      if (isHairline(a) && a.y > bodyTop + EPS) return;
      // A heading rule goes back to where it was drawn, not where a tall heading pushed it here.
      elements.push(isHairline(a) ? { ...structuredClone(r), y: a.y } : structuredClone(r));
      return;
    }
    if (r.id === el.id) {
      const next = structuredClone(r);
      if (tail && (next.type === "text" || next.type === "gap-text")) next.doc = tail;
      next.y = r.y + shift;
      if (wide.has(r.id)) {
        next.x = SAFE.x;
        next.w = SAFE.w;
      }
      next.h = tailH;
      targetIdx = elements.length;
      elements.push(next);
      return;
    }
    if (group.has(r.id)) {
      const next = structuredClone(r);
      if (card && r.id === card.id) {
        next.y = bodyTop;
        next.h = cardFit(bodyTop, cardBottom);
      } else next.y = r.y + shift;
      elements.push(next);
      return;
    }
    if (moving.has(r.id)) {
      const next = structuredClone(r);
      // Below a card the card's bottom edge has not moved; elsewhere the box follows the target.
      next.y = card ? r.y : r.y + shift + trailing;
      if (wide.has(r.id)) widen(next, slide, measure);
      elements.push(next);
    }
  });
  if (targetIdx < 0) return null;

  const continuation = cloneSlide({ ...slide, elements });
  markContinued(continuation, theme);

  if (mode === "move") {
    // Only worth it when the box lands higher than it stood here; otherwise the next round would
    // move it again, slide after slide, and it is better reported as one box that will not fit.
    const landed = reflowSlide(
      continuation,
      theme,
      measure,
      reflowOptions(continuation, theme, measure),
    );
    const at = landed.elements[targetIdx];
    if (!at || at.y > el.y - EPS) return null;
  }

  const removed = new Set(moving);
  if (mode === "split") removed.delete(el.id);
  else for (const id of group) removed.add(id);
  const head = reflowed
    .filter((r) => !removed.has(r.id))
    .map((r) => {
      if (r.id === el.id && headDoc && (r.type === "text" || r.type === "gap-text"))
        return { ...r, doc: headDoc };
      if (card && r.id === card.id) return { ...r, h: cardFit(r.y, cardBottom) };
      return r;
    });
  return { head, continuation };
}

/**
 * Decide what goes onto a continuation slide, or null when nothing sensible can. The target is the
 * topmost overflowing flow box: split if it is a list or several paragraphs, else moved whole with
 * everything under it; and when moving it gains nothing (a single paragraph at the top of the body
 * that is simply too tall), the next splittable box below it is split instead and the paragraph is
 * reported as it is.
 */
function planSplit(
  slide: Slide,
  reflowed: SlideElement[],
  overflow: Id[],
  theme: Theme,
  measure: Measurer,
): Plan | null {
  if (isQuestionSlide(slide)) return null;
  const over = new Set(overflow);
  const order = reflowed.map((el, index) => ({ el, index, y: el.y })).sort(byY);
  const candidates = order.filter((c) => over.has(c.el.id) && isFlow(c.el));
  const first = candidates[0];
  if (!first) return null;
  const attempt = (target: Candidate, mode: "split" | "move") =>
    buildPlan(slide, reflowed, order, target, mode, theme, measure);

  if (splittableDoc(first.el)) return attempt(first, "split");
  const moved = attempt(first, "move");
  if (moved) return moved;
  const next = candidates.find((c) => c !== first && splittableDoc(c.el));
  return next ? attempt(next, "split") : null;
}

/** A slide can spill onto at most this many continuation slides in one tidy. */
const MAX_CONTINUATIONS = 6;

/**
 * Reflow a slide and, while it still will not fit at the smallest legible size, carry the overspill
 * onto a continuation slide — and reflow that too, so each continuation is filled before the next
 * one starts.
 */
function fitAndSplit(
  slide: Slide,
  theme: Theme,
  measure: Measurer,
): { slides: Slide[]; results: ReflowResult[] } {
  const slides: Slide[] = [];
  const results: ReflowResult[] = [];
  let current = slide;

  for (let round = 0; round <= MAX_CONTINUATIONS; round++) {
    let result = reflowSlide(current, theme, measure, reflowOptions(current, theme, measure));
    let next: Slide | null = null;

    if (result.splitAt !== undefined && !isQuestionSlide(current)) {
      // Room above the body is spent before anything goes to another slide.
      const lifted = restack(current, result.elements);
      if (lifted) {
        current = { ...current, elements: lifted };
        result = reflowSlide(current, theme, measure, reflowOptions(current, theme, measure));
      }
    }

    if (result.splitAt !== undefined && round < MAX_CONTINUATIONS) {
      const plan = planSplit(current, result.elements, result.overflow, theme, measure);
      if (plan) {
        current = { ...current, elements: plan.head };
        // Settle the shortened slide before recording it.
        result = reflowSlide(current, theme, measure, reflowOptions(current, theme, measure));
        next = plan.continuation;
      }
    }

    slides.push({ ...current, elements: result.elements });
    results.push(result);
    if (!next) break;
    current = next;
  }

  return { slides: levelHeadings(slides, theme, measure), results };
}

/** How a toast names a box: its first few words, or a card's name. */
function nameOf(el: SlideElement | undefined): string | undefined {
  if (!el) return undefined;
  if (reducers.isTextLike(el)) {
    const words = docToPlainText(el.doc).trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return undefined;
    return words.length > 5 ? `${words.slice(0, 5).join(" ")}\u2026` : words.join(" ");
  }
  return el.name?.trim() || undefined;
}

const sizeOf = (el: SlideElement): number | undefined =>
  el.type === "text" || el.type === "gap-text"
    ? el.style.fontSize
    : el.type === "option"
      ? el.textStyle?.fontSize
      : undefined;

const docOf = (el: SlideElement): RichDoc | undefined =>
  reducers.isTextLike(el) ? el.doc : undefined;

/**
 * Tidy one slide. Safe to call on a slide that is already tidy: it reports `changed: false` and
 * returns the same lesson object, so the button never dirties a clean document.
 */
export function tidySlide(
  lesson: Lesson,
  slideId: Id,
  measure: Measurer,
): { lesson: Lesson; outcome: TidyOutcome } {
  const slide = lesson.slides.find((s) => s.id === slideId);
  if (!slide) return { lesson, outcome: EMPTY };

  const theme = getTheme(lesson.themeId);
  const { slides, results } = fitAndSplit(slide, theme, measure);

  const head = results[0];
  const tidied = slides[0];
  if (!head || !tidied) return { lesson, outcome: EMPTY };
  const continuations = slides.slice(1);
  const before = new Map(slide.elements.map((e) => [e.id, e]));
  const kept = new Set(tidied.elements.map((e) => e.id));
  // Boxes carried whole onto a continuation leave the head slide.
  const removed = slide.elements.filter((e) => !kept.has(e.id)).map((e) => e.id);
  // What still does not fit, on any of the slides the tidy produced.
  const overflow = [...new Set(results.flatMap((r) => r.overflow))];
  const laneOverflow = [...new Set(results.flatMap((r) => r.laneOverflow))];
  const everyElement = new Map(slides.flatMap((s) => s.elements).map((e) => [e.id, e]));
  const overflowText = overflow.flatMap((id) => nameOf(everyElement.get(id)) ?? []);

  const changed = tidied.elements.filter((next) => {
    const prev = before.get(next.id);
    if (!prev) return true;
    if (Math.abs(prev.y - next.y) > 0.5 || Math.abs(prev.h - next.h) > 0.5) return true;
    return sizeOf(prev) !== sizeOf(next) || docOf(prev) !== docOf(next);
  });

  if (changed.length === 0 && continuations.length === 0 && removed.length === 0) {
    return { lesson, outcome: { ...EMPTY, overflow, overflowText, laneOverflow } };
  }

  // `fitElement`, not `updateElement`: a split leaves the head of the words in the box, and that
  // is the engine's doing, not a text edit — an `"ai"` box must not flip to the teacher's here.
  let out = lesson;
  for (const next of changed) {
    out = reducers.fitElement(out, slideId, next.id, {
      y: next.y,
      h: next.h,
      fontSize: sizeOf(next),
      doc: docOf(next),
    });
  }
  if (removed.length > 0) out = reducers.deleteElements(out, slideId, removed);
  let after = slideId;
  for (const continuation of continuations) {
    out = reducers.insertSlide(out, continuation, after);
    after = continuation.id;
  }

  return {
    lesson: out,
    outcome: {
      // Counted against the slide as it was, not the engine's last pass over an already lifted one.
      moved: changed.filter((next) => {
        const prev = before.get(next.id);
        return !!prev && Math.abs(prev.y - next.y) > 0.5;
      }).length,
      stepped: changed.filter((next) => {
        const prev = before.get(next.id);
        return !!prev && sizeOf(prev) !== sizeOf(next);
      }).length,
      continued: continuations.length,
      overflow,
      overflowText,
      laneOverflow,
      changed: true,
    },
  };
}

/**
 * `tidySlide` in reducer shape, for `history.dispatch`: returns `{ lesson, outcome }` so the caller
 * gets the toast's numbers back from the same call that wrote the document.
 */
export const tidySlideReducer = (lesson: Lesson, slideId: Id, measure: Measurer) =>
  tidySlide(lesson, slideId, measure);

/**
 * The sentence the toast shows. Plain counting — and it says so when something still does not fit,
 * because the engine will not go below the text's own projector floor to hide the problem — and
 * names the box by its first words, so a teacher knows which one without hunting for it.
 */
export function tidyMessage(o: TidyOutcome): string {
  const n = o.overflow.length;
  const overflowing = new Set(o.overflow);
  const lane = o.laneOverflow.filter((id) => !overflowing.has(id)).length;
  const count = (k: number) => (k === 1 ? "1 box" : `${k} boxes`);
  const named = (o.overflowText ?? []).map((t) => `"${t}"`);
  const which = named.length ? ` (${named.join(", ")})` : "";
  const stuck = [
    n ? `${count(n)} will not fit at the smallest readable size${which}` : "",
    lane ? `${count(lane)} still covers the room the reason needs` : "",
  ]
    .filter(Boolean)
    .join(", ");
  if (!o.changed) return stuck ? `Nothing left to tidy: ${stuck}` : "Nothing to tidy";
  const parts: string[] = [];
  if (o.moved) parts.push(`${o.moved} ${o.moved === 1 ? "box" : "boxes"} moved`);
  if (o.stepped) parts.push(`${o.stepped} ${o.stepped === 1 ? "size" : "sizes"} stepped down`);
  if (o.continued === 1) parts.push("list continued on a new slide");
  else if (o.continued > 1) parts.push(`list continued on ${o.continued} new slides`);
  if (parts.length === 0) parts.push("boxes resized to their text");
  return `Tidied: ${parts.join(", ")}${stuck ? `. ${stuck[0]?.toUpperCase()}${stuck.slice(1)}` : ""}`;
}
