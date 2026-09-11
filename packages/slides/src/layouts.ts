import type {
  GapTextElement,
  ImageElement,
  OptionElement,
  QuestionData,
  RichDoc,
  ShapeElement,
  SlideElement,
  SlideKind,
  TextElement,
  TextPreset,
  TextStyle,
  Theme,
  TimerElement,
} from "@tj/domain/documents";
import { OBJECTIVES_SLIDE_HEADING, SLIDE_H, SLIDE_W } from "@tj/domain/documents";
import { explanationReserve, RESERVED_LINES } from "./explanation-metrics";
import { docFromBullets, docFromText, newText, uid } from "./factories";
import { BASELINE, colLeft, GUTTER, SAFE, SPACE, snapY, spanWidth, THIRD } from "./grid";
import { OPTION } from "./metrics";
import { fontFloor, getTheme, type TextRole } from "./themes";

/** Local placeholder for new image blocks: no third-party requests (SPEC §0.6). */
export const PLACEHOLDER_IMAGE =
  "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='844' height='1080' viewBox='0 0 844 1080'%3E%3Crect width='844' height='1080' fill='%23E9E8E3'/%3E%3Cpath d='M0 1080 L0 780 L211 600 L422 760 L633 540 L844 700 L844 1080 Z' fill='%23CFCCC4'/%3E%3Ccircle cx='633' cy='300' r='90' fill='%23DFDCD4'/%3E%3C/svg%3E";

/**
 * Default elements for every SlideKind, laid out on the 960x540 grid.
 *
 * Coordinates come from docs/research/04-visual-direction.md §4, which is written
 * in an 800x450 space; every number here is that recipe multiplied by 1.2.
 * Copy is teacher-voice placeholder text the author overwrites — never lorem
 * ipsum, never emoji.
 */

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/** Optical vertical centring bias (research: -8 at 800x450). */
const OPTICAL_BIAS = 10;

/** Full content width. */
const FULL = SAFE.w;
/** Six-column halves. */
const HALF_W = spanWidth(6); // 413
const RIGHT_X = colLeft(6); // 490
/** Bottom edge of the safe area. */
const SAFE_BOTTOM = SAFE.y + SAFE.h; // 497

/** Hairline under a slide heading, and where the body block starts (92 / 116 at 800x450). */
const HAIRLINE_Y = snapY(110);
const BODY_Y = snapY(140);

type Rect = { x: number; y: number; w: number; h: number };
type Layout = { elements: SlideElement[]; question?: QuestionData };

/**
 * One rendered line of a preset, in slide points. Measured at the size the renderer
 * will actually use: a theme stop below its role's projector floor is clamped up
 * there (`fontFloor`), and a box sized for the smaller number would overflow.
 * `role` is passed where the preset cannot say what the text is doing: a question
 * stem is set in the `heading` stop but sits on the 38pt question floor.
 */
const lineHeight = (t: Theme, p: TextPreset, role?: TextRole) =>
  Math.max(t.sizes[p], fontFloor(p, role)) * t.lineHeights[p];
/**
 * Height of a text box holding `lines` lines of a preset. Exported because the demo
 * lesson in `components/slide/demo.ts` is hand-placed and has to be placed against
 * the same numbers: a literal height there is a slide that overlaps itself the next
 * time a floor moves.
 */
export const boxH = (t: Theme, p: TextPreset, lines = 1, role?: TextRole) =>
  Math.ceil(lineHeight(t, p, role) * lines);

/**
 * Height of an answer card holding `lines` lines of card text. Derived, never typed:
 * the text sits on the option floor whatever stop the theme draws `small` at, and
 * `OptionView` draws padding and a border inside the box. One line comes to 93pt, which
 * is why four cards in a column do not fit under a stem and the sort recipe is a grid.
 */
const optionCardH = (t: Theme, lines = 1) =>
  Math.ceil(Math.max(t.sizes.small, fontFloor("small", "option")) * OPTION.line * lines) +
  OPTION.pad * 2 +
  OPTION.border * 2;

/** Vertically centre a block of height h, with the optical bias, on the rhythm. */
const centreY = (h: number) => snapY(Math.round((SLIDE_H - h) / 2 - OPTICAL_BIAS));

/** Text element with style overrides merged in. */
function text(
  preset: TextPreset,
  content: string | RichDoc,
  rect: Rect,
  style: Partial<TextStyle> = {},
  extra: Partial<TextElement> = {},
): TextElement {
  const el = newText(preset, content, rect, extra);
  el.style = { ...el.style, ...style };
  return el;
}

function shape(
  kind: ShapeElement["shape"],
  rect: Rect,
  props: Partial<ShapeElement> = {},
): ShapeElement {
  return { id: uid(), type: "shape", shape: kind, ...rect, ...props };
}

function option(label: string, content: string, rect: Rect): OptionElement {
  return { id: uid(), type: "option", ...rect, doc: docFromText(content), label };
}

/** Ordered-list rich doc — objectives, instructions, exit tickets. */
export function docFromNumbered(items: string[]): RichDoc {
  return {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { start: 1 },
        content: items.map((line) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: line }] }],
        })),
      },
    ],
  };
}

/** The heading + hairline pair that opens most content slides. */
function headed(t: Theme, heading: string): SlideElement[] {
  return [
    text("heading", heading, { x: SAFE.x, y: SAFE.y, w: FULL, h: boxH(t, "heading") }),
    shape(
      "rect",
      { x: SAFE.x, y: HAIRLINE_Y, w: FULL, h: 1 },
      { fill: t.colors.line, name: "Rule" },
    ),
  ];
}

/** A numbered body block under the hairline. */
function numberedBody(t: Theme, items: string[]): TextElement {
  return text("body", docFromNumbered(items), {
    x: SAFE.x,
    y: BODY_Y,
    w: spanWidth(10),
    h: boxH(t, "body", items.length * 1.6),
  });
}

/**
 * Question stem across the top of a question slide (y 48 at 800x450).
 *
 * The stem is set in the theme's `heading` stop but it is a question, not a label, so
 * the box is sized for the `question` floor (38pt, SPEC §7) rather than the 26pt a
 * plain heading may fall to. Two lines of that always fits the stem a teacher types.
 */
function stem(t: Theme, prompt: string, y = STEM_Y): TextElement {
  return text("heading", prompt, { x: SAFE.x, y, w: FULL, h: stemH(t) });
}

/** Top of the stem on a question slide (48 at 800x450). */
const STEM_Y = 58;
/**
 * Height of the stem box, and therefore where the answer block may start.
 * Exported for the hand-placed demo lesson, which has to ask the same question the
 * recipe does rather than carry a number that was right in wave 1.
 */
export const stemH = (t: Theme) => boxH(t, "heading", 2, "question");

/**
 * The band an answer-card block may use on a slide that carries a "Why?" panel:
 * from `top` to the foot of the safe area, less the lane the panel needs
 * (`explanationReserve`, one line of body copy plus the card's own chrome). Cards
 * are capped so two words do not become a slab, and the leftover is spent above
 * them. The layout tests hold this to every theme.
 */
export function cardBand(
  t: Theme,
  top: number,
  cap: number,
  lines: number,
): { y: number; h: number } {
  const room = SAFE_BOTTOM - explanationReserve(t, lines) - top;
  const h = Math.min(cap, room);
  return { y: top + Math.floor(Math.max(0, room - h) / 2 / BASELINE) * BASELINE, h };
}

/** Small caption pinned to the foot of the safe area. */
/** A task instruction pupils must read from the back: `small`, never `caption` (SPEC §7 floor). */
function footnote(t: Theme, label: string): TextElement {
  const h = boxH(t, "small");
  return text(
    "small",
    label,
    { x: SAFE.x, y: SAFE_BOTTOM - h, w: FULL, h },
    { color: t.colors.muted },
  );
}

/* ------------------------------------------------------------------ */
/* Recipes                                                             */
/* ------------------------------------------------------------------ */

/** The 67x4 accent rule that opens a title or a statement, 29 above the eyebrow. */
function accentRule(t: Theme, top: number): ShapeElement {
  return shape(
    "rect",
    { x: SAFE.x, y: top - 29, w: 67, h: 4 },
    { fill: t.colors.accent, name: "Accent rule" },
  );
}

/**
 * The title stack: accent rule, "LESSON" eyebrow, the title over `lines` lines and the class
 * line, optically centred as one block. `titleSlide` sets it across the slide; `titleSplit`
 * sets it beside a photograph, so the widths and the line count are the caller's.
 */
function titleStack(
  t: Theme,
  w: { caption: number; title: number; subtitle: number; lines: number },
): SlideElement[] {
  const capH = boxH(t, "caption");
  const titleH = boxH(t, "title", w.lines);
  const subH = boxH(t, "subtitle");
  const top = centreY(capH + 12 + titleH + 17 + subH);
  return [
    accentRule(t, top),
    text(
      "caption",
      "LESSON",
      { x: SAFE.x, y: top, w: w.caption, h: capH },
      { color: t.colors.muted },
    ),
    text("title", "Lesson title", { x: SAFE.x, y: top + capH + 12, w: w.title, h: titleH }),
    text(
      "subtitle",
      "Year group and class",
      { x: SAFE.x, y: top + capH + 12 + titleH + 17, w: w.subtitle, h: subH },
      { color: t.colors.muted },
    ),
  ];
}

/** Title — left-aligned stack, optically centred, accent rule above the eyebrow. */
function titleSlide(t: Theme): Layout {
  return {
    elements: titleStack(t, {
      caption: FULL,
      title: spanWidth(11),
      subtitle: spanWidth(9),
      lines: 2,
    }),
  };
}

/** The kinds that share the headed-list composition: a heading, a hairline and a short list. */
export type ListKind = "objectives" | "starter" | "instructions" | "exit-ticket" | "plenary";

type ListCopy = {
  heading: string;
  /** The placeholder lines the default recipe lists. */
  items: string[];
  /** Further placeholder lines the slot variants lay when the kind's spec allows more items. */
  more?: string[];
  footnote?: string;
};

/**
 * How many items a kind's spec may carry (`specs.ts`), and so how many slots the `cards` and
 * `stepped` variants lay: a slot per item the model may send, the way `vocabularySlots` sizes
 * the vocabulary grid. The numbered recipe lists `items` only, as it always has.
 */
export const LIST_SLOTS: Record<ListKind, number> = {
  objectives: 4,
  starter: 3,
  instructions: 4,
  "exit-ticket": 3,
  plenary: 3,
};

/**
 * Placeholder copy for the headed-list family, one entry per kind. The three list variants
 * (`numbered`, `cards`, `stepped`) all read from here so a kind says its words once.
 */
const LIST_COPY = {
  // The "I can" stem as the heading, lower-case verb phrases that complete it (UX ruling 64,
  // TEACH-198); `fillObjectives` writes the same shape on every variant.
  objectives: {
    heading: OBJECTIVES_SLIDE_HEADING,
    items: ["learning objective one", "learning objective two", "learning objective three"],
    more: ["learning objective four"],
  },
  starter: {
    heading: "Do now",
    items: [
      "Recall question from last lesson",
      "Recall question from last term",
      "Stretch question",
    ],
    footnote: "5 minutes. Work in silence and answer in your book.",
  },
  instructions: {
    heading: "Task",
    items: [
      "What to do first",
      "What to do next",
      "Where to write your answer",
      "If you finish early, extend it",
    ],
    footnote: "10 minutes. Work quietly.",
  },
  "exit-ticket": {
    heading: "Exit ticket",
    items: [
      "One thing you learnt today",
      "One question you still have",
      "One word that sums this up",
    ],
    footnote: "Answer on a sticky note and hand it to me on the way out",
  },
  plenary: {
    heading: "What have we learned?",
    items: [
      "Something we can now explain",
      "Something we can now do",
      "Something to practise next lesson",
    ],
  },
} as const satisfies Record<ListKind, ListCopy>;

/**
 * Learning objectives — the "I can" stem as the heading, a hairline, three numbered verb
 * phrases that complete it (UX ruling 64, TEACH-198).
 */
function objectivesSlide(t: Theme): Layout {
  const { heading, items } = LIST_COPY.objectives;
  return { elements: [...headed(t, heading), numberedBody(t, [...items])] };
}

/** Do now — retrieval questions and a time cue. */
function starterSlide(t: Theme): Layout {
  const { heading, items, footnote: foot } = LIST_COPY.starter;
  return { elements: [...headed(t, heading), numberedBody(t, [...items]), footnote(t, foot)] };
}

/**
 * The vocabulary grid: term height, definition height, the pitch between entries and
 * how many rows a column holds, all derived from the theme's own line heights and the
 * projector floors under them.
 *
 * Exported and named because two places lay this slide out — the recipe below and the
 * hand-placed demo lesson in `components/slide/demo.ts` — and the demo drifting from
 * the recipe is exactly how the definitions ended up through the rule beneath them
 * when wave 4 raised the floors.
 *
 * Definitions are sized for two lines: a one-line box wraps and overlaps the moment a
 * teacher types a real sentence. `ruleGap` is where the hairline between two entries
 * sits above the term it introduces.
 */
export type VocabGrid = {
  termH: number;
  defH: number;
  /** Vertical distance between one entry's term and the next one's. */
  pitch: number;
  /** Entries per column: three when the theme's type leaves room, else two. */
  rows: number;
  /** Top of the first term in a column. */
  top: number;
  /** Gap between a term and its definition. */
  termGap: number;
  /** How far above a term the hairline that separates it from the entry above sits. */
  ruleGap: number;
};

export function vocabularyGrid(t: Theme): VocabGrid {
  const termH = boxH(t, "body");
  // Pitch from the theme's real line heights (research pitch 92@800 assumed 1.4 leading).
  const defH = boxH(t, "small", 2);
  const termGap = 7;
  const pitch = snapY(termH + termGap + defH + SPACE[3]);
  const rows = BODY_Y + 2 * pitch + termH + termGap + defH <= SAFE_BOTTOM ? 3 : 2;
  return { termH, defH, pitch, rows, top: BODY_Y, termGap, ruleGap: 17 };
}

/** Key vocabulary — two columns, three term/definition entries each. */
function vocabularySlide(t: Theme): Layout {
  const els: SlideElement[] = headed(t, "Key vocabulary");
  const g = vocabularyGrid(t);
  for (let i = 0; i < g.rows * 2; i++) {
    const x = i < g.rows ? SAFE.x : RIGHT_X;
    const row = i % g.rows;
    const y = g.top + row * g.pitch;
    if (row > 0)
      els.push(
        shape(
          "rect",
          { x, y: y - g.ruleGap, w: HALF_W, h: 1 },
          { fill: t.colors.line, name: "Rule" },
        ),
      );
    els.push(
      text(
        "body",
        "Term",
        { x, y, w: HALF_W, h: g.termH },
        { color: t.colors.accent, fontWeight: 600 },
      ),
      text(
        "small",
        "Definition in one sentence",
        { x, y: y + g.termH + g.termGap, w: HALF_W, h: g.defH },
        { color: t.colors.muted },
      ),
    );
  }
  return { elements: els };
}

/** Explanation — one idea, a heading and a short body. */
function contentSlide(t: Theme): Layout {
  return {
    elements: [
      ...headed(t, "Heading"),
      text("body", "One idea, explained in a sentence or two. Keep it under forty words.", {
        x: SAFE.x,
        y: BODY_Y,
        w: spanWidth(9),
        h: boxH(t, "body", 4),
      }),
    ],
  };
}

/** Image left (full-bleed) / text right — the deliberate grid break. */
function imageTextSlide(t: Theme): Layout {
  const image: ImageElement = {
    id: uid(),
    type: "image",
    x: 0,
    y: 0,
    w: 422,
    h: SLIDE_H,
    src: PLACEHOLDER_IMAGE,
    alt: "Describe this image for pupils using a screen reader",
    fit: "cover",
    name: "Image",
  };
  const capH = boxH(t, "caption");
  const headH = boxH(t, "heading", 2);
  const bodyH = boxH(t, "body", 4);
  const top = centreY(capH + 12 + headH + 19 + bodyH);
  const X = 480;
  const W = 422;
  return {
    elements: [
      image,
      text("caption", "KEY IDEA", { x: X, y: top, w: W, h: capH }, { color: t.colors.muted }),
      text("heading", "What the picture shows", { x: X, y: top + capH + 12, w: W, h: headH }),
      text("body", "Two or three sentences that link the image to the idea.", {
        x: X,
        y: top + capH + 12 + headH + 19,
        w: W,
        h: bodyH,
      }),
    ],
  };
}

/** Worked example — the problem left, the teacher's working right on a tinted card. */
function workedExampleSlide(t: Theme): Layout {
  // Question on top, the working on a full-width card below (TEACH-247). Side by side, the card's
  // 365pt column held six body lines at the floor — three two-line steps — while the spec allows
  // four; stacked, four steps of `SPEC_LIMITS.step` characters are one line each at the floor and
  // fit the card with the two-line question above. The heading frames the question, so it needs
  // no label; the working keeps its caption.
  const capH = boxH(t, "caption");
  const questionH = boxH(t, "body", 2);
  const pad = SPACE[3];
  const cardY = snapY(BODY_Y + questionH + SPACE[2]);
  // Short of the safe edge by the fit engine's cushion (`SAFETY`), so the card itself is never
  // reported as an overflow.
  const cardBottom = SAFE_BOTTOM - SPACE[1];
  const workingY = cardY + pad + capH + 12;
  return {
    elements: [
      ...headed(t, "Worked example"),
      text("body", "Write the question exactly as pupils will see it.", {
        x: SAFE.x,
        y: BODY_Y,
        w: FULL,
        h: questionH,
      }),
      shape(
        "rounded",
        { x: SAFE.x, y: cardY, w: FULL, h: cardBottom - cardY },
        { fill: t.colors.surface, radius: t.radius, name: "Working card" },
      ),
      text(
        "caption",
        "WORKING",
        { x: SAFE.x + pad, y: cardY + pad, w: FULL - 2 * pad, h: capH },
        { color: t.colors.muted },
      ),
      text(
        "body",
        docFromNumbered(["First step, and why", "Second step, and why", "The answer"]),
        { x: SAFE.x + pad, y: workingY, w: FULL - 2 * pad, h: cardBottom - pad - workingY },
        {},
        { revealStep: 1, reveal: "rise" },
      ),
    ],
  };
}

/** Instructions — the task, numbered steps, and how long it takes. */
function instructionsSlide(t: Theme): Layout {
  const { heading, items, footnote: foot } = LIST_COPY.instructions;
  return { elements: [...headed(t, heading), numberedBody(t, [...items]), footnote(t, foot)] };
}

/** Discussion — one big prompt and a named talk structure. */
function discussionSlide(t: Theme): Layout {
  const promptH = boxH(t, "subtitle", 3);
  return {
    elements: [
      text("subtitle", "Ask the question you want pupils to talk about.", {
        x: SAFE.x,
        y: centreY(promptH),
        w: spanWidth(10),
        h: promptH,
      }),
      footnote(t, "Talk to your partner"),
    ],
  };
}

/** True or false — one statement, two big cards, the "Why?" lane kept free below. */
function trueFalseSlide(t: Theme): Layout {
  const prompt = stem(t, "Write a statement that is clearly true or clearly false.");
  const { y, h } = cardBand(
    t,
    snapY(prompt.y + prompt.h + SPACE[4]),
    140,
    RESERVED_LINES["true-false"],
  );
  const yes = option("True", "True", { x: SAFE.x, y, w: HALF_W, h });
  const no = option("False", "False", { x: RIGHT_X, y, w: HALF_W, h });
  return {
    elements: [prompt, yes, no],
    question: { type: "true-false", correct: true },
  };
}

/**
 * Multiple choice — four lettered cards in a 2x2 grid. The stem starts at the top
 * of the safe area rather than the usual 58: four cards and the "Why?" lane leave
 * no room to spare, and the stem still gets its two lines.
 */
function multipleChoiceSlide(t: Theme): Layout {
  const prompt = stem(t, "Ask a question with one right answer.", SAFE.y);
  const ROW_GAP = SPACE[2];
  const band = cardBand(
    t,
    snapY(prompt.y + prompt.h + SPACE[2]),
    106 * 2 + ROW_GAP,
    RESERVED_LINES["multiple-choice"],
  );
  const cardH = Math.floor((band.h - ROW_GAP) / 2);
  const opts = ["A", "B", "C", "D"].map((label, i) =>
    option(label, `Option ${label}`, {
      x: i % 2 === 0 ? SAFE.x : RIGHT_X,
      y: band.y + (i < 2 ? 0 : cardH + ROW_GAP),
      w: HALF_W,
      h: cardH,
    }),
  );
  return {
    elements: [prompt, ...opts],
    question: {
      type: "multiple-choice",
      options: opts.map((o, i) => ({ id: o.id, correct: i === 0 })),
    },
  };
}

/** Matching — three terms left, three definitions right. */
function matchingSlide(t: Theme): Layout {
  const CARD_H = 72;
  const PITCH = 88;
  const TOP = 190;
  const left = [0, 1, 2].map((i) =>
    text(
      "body",
      `Term ${i + 1}`,
      { x: SAFE.x, y: TOP + i * PITCH, w: HALF_W, h: CARD_H },
      { valign: "middle" },
    ),
  );
  const right = [0, 1, 2].map((i) =>
    text(
      "body",
      `Definition ${i + 1}`,
      { x: RIGHT_X, y: TOP + i * PITCH, w: HALF_W, h: CARD_H },
      { valign: "middle", color: t.colors.muted },
    ),
  );
  return {
    elements: [stem(t, "Match each term to its definition."), ...left, ...right],
    question: {
      type: "matching",
      pairs: left.map((l, i) => ({
        id: uid(),
        leftElementId: l.id,
        rightElementId: right[i]?.id ?? l.id,
      })),
    },
  };
}

/**
 * A derangement of 0..n-1: no index maps to itself, so no word can start in the
 * slot under the picture it names. `(i + 1) mod n` is the cheapest one and holds
 * for every n above 1; n of 1 has no derangement and returns [0].
 */
export function derange(n: number): number[] {
  return Array.from({ length: n }, (_, i) => (i + 1) % n);
}

/**
 * Image matching — pictures in a row, a word under each, shuffled so no word
 * starts under the picture it names. The reveal draws the right word under each
 * picture (`ImageMatchAnswers` in `components/slide/SlideView.tsx`).
 */
function imageMatchSlide(t: Theme): Layout {
  // Three across: the narrowest a picture can be and still carry to the back of a
  // classroom. Widths are divided out of the safe box rather than taken from
  // `spanWidth(4)`, which is a point wider than a third of it.
  const COUNT = 3;
  const W = Math.floor((SAFE.w - GUTTER * (COUNT - 1)) / COUNT);
  const XS = [0, 1, 2].map((i) => SAFE.x + i * (W + GUTTER));
  const TOP = snapY(180);
  const GAP = SPACE[2];
  const labelH = boxH(t, "body");
  const imageH = SAFE_BOTTOM - TOP - GAP - labelH;
  const words = ["Word one", "Word two", "Word three"];
  /** The slot under picture i holds the word for picture SHUFFLE[i]. */
  const SHUFFLE = derange(COUNT);
  const images: ImageElement[] = XS.map((x, i) => ({
    id: uid(),
    type: "image",
    x,
    y: TOP,
    w: W,
    h: imageH,
    src: PLACEHOLDER_IMAGE,
    alt: "Describe this picture for pupils using a screen reader",
    fit: "cover",
    radius: t.radius,
    name: `Picture ${i + 1}`,
  }));
  const labels = XS.map((x, i) =>
    text(
      "body",
      words[SHUFFLE[i] ?? i] ?? "",
      { x, y: TOP + imageH + GAP, w: W, h: labelH },
      { align: "center", valign: "middle" },
    ),
  );
  return {
    elements: [stem(t, "Match each word to the picture it names."), ...images, ...labels],
    question: {
      type: "image-match",
      pairs: images.map((img, i) => ({
        id: uid(),
        imageId: img.id,
        labelId: labels[SHUFFLE.indexOf(i)]?.id ?? img.id,
      })),
    },
  };
}

/** Fill the gap — a short sentence with two blanks. */
function fillGapSlide(t: Theme): Layout {
  const gapA = uid();
  const gapB = uid();
  const gap: GapTextElement = {
    id: uid(),
    type: "gap-text",
    x: SAFE.x,
    y: 190,
    w: spanWidth(10),
    h: boxH(t, "subtitle", 3),
    doc: docFromText(
      `Water turns into vapour when it [[gap:${gapA}]], and back into a liquid when it [[gap:${gapB}]].`,
    ),
    style: { preset: "subtitle", autoHeight: true },
    name: "Gap text",
  };
  return {
    elements: [stem(t, "Complete the sentence."), gap],
    question: {
      type: "fill-gap",
      gaps: [
        { id: gapA, answer: "evaporates" },
        { id: gapB, answer: "condenses" },
      ],
    },
  };
}

/**
 * Sort — four cards two by two, held in the correct order (reading order: top row
 * left to right, then the bottom row).
 *
 * The column of four research/04 draws does not survive the option floor. A card's
 * text sits at 31pt (SPEC §7 per-role minimums), which with its own leading, padding
 * and border makes the card 93pt tall, and four of those plus their gaps run 60pt past
 * the foot of the slide: the first Tidy pushed the last card off the bottom. Two rows
 * of two, each card half the content width, fit under the stem in every theme with the
 * cushion the engine wants and room to spare. The height is derived from the floor and
 * the card's own chrome rather than typed, so a change to either moves the cards
 * instead of quietly overflowing them.
 */
function sortSlide(t: Theme): Layout {
  const cardH = optionCardH(t);
  const gap = SPACE[3];
  const gridH = cardH * 2 + gap;
  const bandTop = STEM_Y + stemH(t) + SPACE[4];
  const top = snapY(bandTop + Math.max(0, (SAFE_BOTTOM - bandTop - gridH) / 2));
  const cards = [0, 1, 2, 3].map((i) =>
    option(String(i + 1), `Step ${i + 1}`, {
      x: i % 2 === 0 ? SAFE.x : RIGHT_X,
      y: top + Math.floor(i / 2) * (cardH + gap),
      w: HALF_W,
      h: cardH,
    }),
  );
  return {
    elements: [stem(t, "Put these in the right order."), ...cards],
    question: { type: "sort", order: cards.map((c) => c.id) },
  };
}

/** Open response — a question and a big space to answer it in. */
function openResponseSlide(t: Theme): Layout {
  return {
    elements: [
      stem(t, "Ask an open question worth writing about."),
      shape(
        "rounded",
        { x: SAFE.x, y: 200, w: FULL, h: 240 },
        {
          fill: t.colors.surface,
          stroke: t.colors.line,
          strokeWidth: 1,
          radius: t.radius,
          name: "Answer space",
        },
      ),
      footnote(t, "Write your answer"),
    ],
    // Without this the slide is not a question slide: the answer drawer, the model
    // answer field and "Show answers" on export all key off `slide.question`.
    question: { type: "open-response" },
  };
}

/** Exit ticket — three quick questions. Never revealed (research §1, decision 5). */
function exitTicketSlide(t: Theme): Layout {
  const { heading, items, footnote: foot } = LIST_COPY["exit-ticket"];
  return { elements: [...headed(t, heading), numberedBody(t, [...items]), footnote(t, foot)] };
}

/** Timer — a task reminder and one big countdown. */
function timerSlide(t: Theme): Layout {
  const timer: TimerElement = {
    id: uid(),
    type: "timer",
    x: (SLIDE_W - 300) / 2,
    y: snapY(230),
    w: 300,
    h: 140,
    seconds: 300,
    name: "Timer",
  };
  return { elements: [...headed(t, "Time to work"), timer] };
}

/** Plenary — what have we learned? */
function plenarySlide(t: Theme): Layout {
  const { heading, items } = LIST_COPY.plenary;
  return {
    elements: [
      ...headed(t, heading),
      text("body", docFromBullets([...items]), {
        x: SAFE.x,
        y: BODY_Y,
        w: spanWidth(10),
        h: boxH(t, "body", items.length * 1.6),
      }),
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Variants (TEACH-214)                                                */
/* ------------------------------------------------------------------ */

/*
 * A second and third composition for the three families that carry a ten-slide lesson.
 * Every variant shares `headed`, `stem`, `boxH` and the floors with the recipes above, so
 * the fit engine and the lint need no change. Elements a filler must find by something
 * other than its preset carry a `name` ("Subtitle", "Item 2"); the default recipes carry
 * none, so `layoutSlide(kind, themeId)` stays byte-identical to what it was.
 */

/** A full-bleed photograph the illustrator replaces; a placeholder until then. */
function photo(rect: Rect): ImageElement {
  return {
    id: uid(),
    type: "image",
    ...rect,
    src: PLACEHOLDER_IMAGE,
    alt: "Describe this image for pupils using a screen reader",
    fit: "cover",
    name: "Photo",
  };
}

/**
 * Title, `photo-band`: the photograph fills the slide and the title sits in an ink band across
 * its foot, run to the edges like the picture (a shape flush with an edge and inside the slide
 * is a bleed to the lint, as a picture is). The band's top is 340 where the theme's type allows
 * and higher where it does not: a two-line title on the 48pt title floor plus the class line
 * will not fit under 340 inside the safe area on any theme.
 */
function titlePhotoBand(t: Theme): Layout {
  const titleH = boxH(t, "title", 2);
  const subH = boxH(t, "small");
  const stackH = titleH + SPACE[1] + subH;
  const bandY = Math.min(340, snapY(SAFE_BOTTOM - stackH - SPACE[3]));
  return {
    elements: [
      photo({ x: 0, y: 0, w: SLIDE_W, h: SLIDE_H }),
      shape(
        "rect",
        { x: 0, y: bandY, w: SLIDE_W, h: SLIDE_H - bandY },
        { fill: t.colors.ink, opacity: 0.88, name: "Band" },
      ),
      text(
        "title",
        "Lesson title",
        { x: SAFE.x, y: SAFE_BOTTOM - stackH, w: spanWidth(11), h: titleH },
        { color: t.colors.onAccent, valign: "bottom" },
        { name: "Title" },
      ),
      text(
        "small",
        "Year group and class",
        { x: SAFE.x, y: SAFE_BOTTOM - subH, w: spanWidth(9), h: subH },
        { color: t.colors.onAccent },
        { name: "Subtitle" },
      ),
    ],
  };
}

/** Title, `split`: the stack on the left over three lines, a photograph filling the right half. */
function titleSplit(t: Theme): Layout {
  const W = SLIDE_W / 2 - SAFE.x - GUTTER; // 403
  return {
    elements: [
      photo({ x: SLIDE_W / 2, y: 0, w: SLIDE_W / 2, h: SLIDE_H }),
      ...titleStack(t, { caption: W, title: W, subtitle: W, lines: 3 }),
    ],
  };
}

/**
 * Content, `statement`: one sentence at subtitle size, optically centred, with the heading
 * reduced to an eyebrow above it. For bodies under twenty words; the subtitle stop sits on
 * the 48pt title floor, so three lines is all the box holds.
 */
function contentStatement(t: Theme): Layout {
  const capH = boxH(t, "caption");
  const bodyH = boxH(t, "subtitle", 3);
  const top = centreY(capH + 12 + bodyH);
  return {
    elements: [
      accentRule(t, top),
      text(
        "caption",
        "KEY IDEA",
        { x: SAFE.x, y: top, w: FULL, h: capH },
        { color: t.colors.muted },
        { name: "Eyebrow" },
      ),
      text(
        "subtitle",
        "One idea in a sentence pupils can read from the back.",
        { x: SAFE.x, y: top + capH + 12, w: spanWidth(10), h: bodyH },
        {},
        { name: "Statement" },
      ),
    ],
  };
}

/**
 * Content, `two-column`: heading and hairline, the body in the grid's two six-column halves
 * (`HALF_W` at `SAFE.x` and `RIGHT_X`, as the vocabulary and worked-example recipes use them),
 * each given the room down to the foot of the safe area so the fit engine sees a true box.
 */
function contentTwoColumn(t: Theme): Layout {
  const h = SAFE_BOTTOM - BODY_Y;
  return {
    elements: [
      ...headed(t, "Heading"),
      text(
        "body",
        "The first part of the idea, up to its first full stop.",
        { x: SAFE.x, y: BODY_Y, w: HALF_W, h },
        {},
        { name: "Body left" },
      ),
      text(
        "body",
        "The rest of the idea, in the second column.",
        { x: RIGHT_X, y: BODY_Y, w: HALF_W, h },
        {},
        { name: "Body right" },
      ),
    ],
  };
}

/** Where a list variant's last block may reach: above the footnote when the kind has one. */
function listBottom(foot?: TextElement): number {
  return foot ? foot.y - SPACE[3] : SAFE_BOTTOM;
}

/** The placeholder lines a slot variant lays: one per item the kind's spec may carry. */
function slotItems(kind: ListKind): string[] {
  const copy: ListCopy = LIST_COPY[kind];
  return [...copy.items, ...(copy.more ?? [])].slice(0, LIST_SLOTS[kind]);
}

/** Inset between a card's edge and the text on it. */
const CARD_PAD = SPACE[3];

/**
 * Headed list, `cards`: each item on its own surface card, three across for up to three
 * slots and two by two for four. A card is as tall as three lines of its text plus the inset,
 * no taller than the room allows, and the row is centred in the room. `materialiseSlide`
 * drops the cards a spec does not fill and refuses a spec with more items than slots.
 */
function cardsList(t: Theme, kind: ListKind): Layout {
  const copy: ListCopy = LIST_COPY[kind];
  const items = slotItems(kind);
  const foot = copy.footnote ? footnote(t, copy.footnote) : undefined;
  const bottom = listBottom(foot);
  const grid = items.length > 3;
  const rows = grid ? 2 : 1;
  const gap = SPACE[3];
  const room = bottom - BODY_Y;
  const cardW = grid ? HALF_W : THIRD.w;
  const cardH = Math.min(
    boxH(t, "body", 3) + CARD_PAD * 2,
    Math.floor((room - gap * (rows - 1)) / rows),
  );
  const blockH = cardH * rows + gap * (rows - 1);
  const top = BODY_Y + Math.floor((room - blockH) / 2 / BASELINE) * BASELINE;
  const els: SlideElement[] = headed(t, copy.heading);
  items.forEach((item, i) => {
    const x = grid ? (i % 2 === 0 ? SAFE.x : RIGHT_X) : (THIRD.xs[i] ?? SAFE.x);
    const y = grid && i >= 2 ? top + cardH + gap : top;
    els.push(
      shape(
        "rounded",
        { x, y, w: cardW, h: cardH },
        { fill: t.colors.surface, radius: t.radius, name: `Card ${i + 1}` },
      ),
      text(
        "body",
        item,
        { x: x + CARD_PAD, y: y + CARD_PAD, w: cardW - CARD_PAD * 2, h: cardH - CARD_PAD * 2 },
        {},
        { name: `Item ${i + 1}` },
      ),
    );
  });
  if (foot) els.push(foot);
  return { elements: els };
}

/** Side of the numeral block on a `stepped` list (research/04 draws 28 at 800x450). */
const STEP_BLOCK = 40;

/**
 * Headed list, `stepped`: a numeral block in the accent beside each item, one slot per item
 * the kind's spec may carry, spaced evenly down the slide. Two lines are kept for each item
 * where the theme's type leaves room, one where it does not, so four steps and a footnote
 * still sit inside the safe area.
 */
function steppedList(t: Theme, kind: ListKind): Layout {
  const copy: ListCopy = LIST_COPY[kind];
  const items = slotItems(kind);
  const foot = copy.footnote ? footnote(t, copy.footnote) : undefined;
  const bottom = listBottom(foot);
  const n = items.length;
  const room = bottom - BODY_Y;
  const spacing = (itemH: number) =>
    n > 1
      ? Math.min(itemH + SPACE[3], Math.floor((room - itemH) / (n - 1) / BASELINE) * BASELINE)
      : itemH;
  let itemH = boxH(t, "body", 2);
  let pitch = spacing(itemH);
  if (pitch < itemH) {
    itemH = boxH(t, "body");
    pitch = spacing(itemH);
  }
  const textX = SAFE.x + STEP_BLOCK + SPACE[3];
  const els: SlideElement[] = headed(t, copy.heading);
  items.forEach((item, i) => {
    const y = BODY_Y + i * pitch;
    els.push(
      shape(
        "rounded",
        {
          x: SAFE.x,
          y: y + Math.round((lineHeight(t, "body") - STEP_BLOCK) / 2),
          w: STEP_BLOCK,
          h: STEP_BLOCK,
        },
        {
          fill: t.colors.accent,
          radius: Math.min(t.radius, 8),
          doc: docFromText(String(i + 1)),
          textStyle: { preset: "small", color: t.colors.onAccent, fontWeight: 600, padding: 2 },
          name: `Step ${i + 1}`,
        },
      ),
      text(
        "body",
        item,
        { x: textX, y, w: spanWidth(10) - STEP_BLOCK - SPACE[3], h: itemH },
        {},
        { name: `Item ${i + 1}` },
      ),
    );
  });
  if (foot) els.push(foot);
  return { elements: els };
}

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

/** The variant names, typed so a filler's comparison and a catalogue entry are both checked. */
export const TITLE_VARIANT_NAMES = ["stack", "photo-band", "split"] as const;
export const CONTENT_VARIANT_NAMES = ["headed", "statement", "two-column"] as const;
export const LIST_VARIANT_NAMES = ["numbered", "cards", "stepped"] as const;
/** The one composition each remaining kind has, named for a picker. */
const SINGLE_VARIANT_NAMES = [
  "grid",
  "photo-left",
  "working-card",
  "prompt",
  "two-cards",
  "card-grid",
  "columns",
  "picture-row",
  "gap-sentence",
  "answer-space",
  "countdown",
  "blank",
] as const;

export type TitleVariant = (typeof TITLE_VARIANT_NAMES)[number];
export type ContentVariant = (typeof CONTENT_VARIANT_NAMES)[number];
export type ListVariant = (typeof LIST_VARIANT_NAMES)[number];
type SingleVariant = (typeof SINGLE_VARIANT_NAMES)[number];
export type VariantName = TitleVariant | ContentVariant | ListVariant | SingleVariant;

/** The variant names a kind can take. */
export type VariantOf<K extends SlideKind> = K extends "title"
  ? TitleVariant
  : K extends "content"
    ? ContentVariant
    : K extends ListKind
      ? ListVariant
      : SingleVariant;

/** One composition a kind can be laid out in. */
export type LayoutVariant<N extends VariantName = VariantName> = {
  /** The name `layoutSlide` and `chooseVariant` use; the first in a kind's list is the default. */
  name: N;
  /**
   * The composition the variant draws. Two variants with the same composition look alike
   * from the back of the room, whatever their kind: a content slide's `headed` paragraph and
   * an objectives slide's `numbered` list are both a heading, a hairline and a block of text.
   */
  composition: string;
  /** One line for a picker. */
  description: string;
};

const one = <N extends SingleVariant>(
  name: N,
  description: string,
): readonly LayoutVariant<N>[] => [{ name, composition: name, description }];

/** The three compositions every headed-list kind offers. */
const LIST_VARIANTS: readonly LayoutVariant<ListVariant>[] = [
  {
    name: "numbered",
    composition: "headed",
    description: "A heading, a hairline and a numbered list",
  },
  { name: "cards", composition: "cards", description: "Each item on its own card" },
  {
    name: "stepped",
    composition: "stepped",
    description: "A numeral block in the accent beside each item",
  },
];

/**
 * The layout catalogue: the variants each kind offers, the default first. Question kinds,
 * vocabulary and the picture slides keep their one composition (research §3.5: the option
 * cards must be where pupils expect them).
 */
export const LAYOUT_CATALOGUE: {
  readonly [K in SlideKind]: readonly LayoutVariant<VariantOf<K>>[];
} = {
  title: [
    {
      name: "stack",
      composition: "stack",
      description: "Rule, eyebrow, title and class, stacked left",
    },
    {
      name: "photo-band",
      composition: "photo-band",
      description: "A photograph filling the slide, the title in a band across its foot",
    },
    {
      name: "split",
      composition: "split",
      description: "The title left, a photograph filling the right half",
    },
  ],
  objectives: LIST_VARIANTS,
  starter: LIST_VARIANTS,
  vocabulary: one("grid", "Terms and definitions in two columns"),
  content: [
    {
      name: "headed",
      composition: "headed",
      description: "A heading, a hairline and one paragraph",
    },
    {
      name: "statement",
      composition: "statement",
      description: "One sentence at subtitle size, no heading",
    },
    {
      name: "two-column",
      composition: "two-column",
      description: "A heading and the body in two columns",
    },
  ],
  "image-text": one("photo-left", "A picture down the left, the text beside it"),
  "worked-example": one("working-card", "The question on top, the working on a card below"),
  instructions: LIST_VARIANTS,
  discussion: one("prompt", "One big prompt"),
  "true-false": one("two-cards", "A statement and two cards"),
  "multiple-choice": one("card-grid", "A stem and four cards two by two"),
  matching: one("columns", "Terms left, definitions right"),
  "image-match": one("picture-row", "Pictures in a row, a word under each"),
  "fill-gap": one("gap-sentence", "A sentence with blanks"),
  sort: one("card-grid", "A stem and four cards two by two"),
  "open-response": one("answer-space", "A question and room to answer it"),
  "exit-ticket": LIST_VARIANTS,
  timer: one("countdown", "A task reminder and a countdown"),
  plenary: LIST_VARIANTS,
  blank: one("blank", "Nothing"),
};

/** The variant names a kind offers, the default first. */
export function variantsFor<K extends SlideKind>(kind: K): VariantOf<K>[] {
  const list: readonly LayoutVariant<VariantOf<K>>[] = LAYOUT_CATALOGUE[kind];
  return list.map((v) => v.name);
}

/**
 * Resolve a variant given by index or by name to a name the kind offers. Anything the kind
 * does not offer (an index past the list, a name from another family) resolves to the
 * default, so a stale choice draws today's composition rather than nothing.
 */
export function variantName<K extends SlideKind>(
  kind: K,
  variant: number | string = 0,
): VariantOf<K> {
  const list: readonly LayoutVariant<VariantOf<K>>[] = LAYOUT_CATALOGUE[kind];
  const found = typeof variant === "number" ? list[variant] : list.find((v) => v.name === variant);
  const chosen = found ?? list[0];
  if (!chosen) throw new Error(`no variants for ${kind}`);
  return chosen.name;
}

/** The composition a kind draws for a variant (see `LayoutVariant.composition`). */
export function compositionOf(kind: SlideKind, variant: number | string = 0): string {
  const name = variantName(kind, variant);
  const list: readonly LayoutVariant[] = LAYOUT_CATALOGUE[kind];
  return list.find((v) => v.name === name)?.composition ?? name;
}

function titleVariant(t: Theme, variant: number | string): Layout {
  switch (variantName("title", variant)) {
    case "photo-band":
      return titlePhotoBand(t);
    case "split":
      return titleSplit(t);
    case "stack":
      return titleSlide(t);
  }
}

function contentVariant(t: Theme, variant: number | string): Layout {
  switch (variantName("content", variant)) {
    case "statement":
      return contentStatement(t);
    case "two-column":
      return contentTwoColumn(t);
    case "headed":
      return contentSlide(t);
  }
}

function listVariant(
  t: Theme,
  kind: ListKind,
  variant: number | string,
  numbered: () => Layout,
): Layout {
  switch (variantName(kind, variant)) {
    case "cards":
      return cardsList(t, kind);
    case "stepped":
      return steppedList(t, kind);
    case "numbered":
      return numbered();
  }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Lay a slide out. `variant` picks a composition from `LAYOUT_CATALOGUE[kind]` by index or
 * by name; left out (or 0) it is the kind's default, which is the recipe every existing
 * caller has always had.
 */
export function layoutSlide(
  kind: SlideKind,
  themeId: string,
  variant: number | string = 0,
): Layout {
  const t = getTheme(themeId);
  switch (kind) {
    case "blank":
      return { elements: [] };
    case "title":
      return titleVariant(t, variant);
    case "objectives":
      return listVariant(t, kind, variant, () => objectivesSlide(t));
    case "starter":
      return listVariant(t, kind, variant, () => starterSlide(t));
    case "vocabulary":
      return vocabularySlide(t);
    case "content":
      return contentVariant(t, variant);
    case "image-text":
      return imageTextSlide(t);
    case "worked-example":
      return workedExampleSlide(t);
    case "instructions":
      return listVariant(t, kind, variant, () => instructionsSlide(t));
    case "discussion":
      return discussionSlide(t);
    case "true-false":
      return trueFalseSlide(t);
    case "multiple-choice":
      return multipleChoiceSlide(t);
    case "matching":
      return matchingSlide(t);
    case "image-match":
      return imageMatchSlide(t);
    case "fill-gap":
      return fillGapSlide(t);
    case "sort":
      return sortSlide(t);
    case "open-response":
      return openResponseSlide(t);
    case "exit-ticket":
      return listVariant(t, kind, variant, () => exitTicketSlide(t));
    case "timer":
      return timerSlide(t);
    case "plenary":
      return listVariant(t, kind, variant, () => plenarySlide(t));
  }
}

/** Pedagogical labels for the "Add slide" picker (SPEC §7). */
export const SLIDE_KIND_LABELS: Record<SlideKind, string> = {
  title: "Title",
  objectives: "Learning objectives",
  starter: "Do now",
  vocabulary: "Key vocabulary",
  content: "Explanation",
  "image-text": "Image and text",
  "worked-example": "Worked example",
  instructions: "Instructions",
  discussion: "Discussion",
  "true-false": "True or false",
  "multiple-choice": "Multiple choice",
  matching: "Matching",
  "image-match": "Image matching",
  "fill-gap": "Fill the gap",
  sort: "Sort",
  "open-response": "Open response",
  "exit-ticket": "Exit ticket",
  timer: "Timer",
  plenary: "Plenary",
  blank: "Blank",
};

/**
 * The one-line description under each name in the picker (Chalkie parity,
 * `docs/reference/chalkie/INVENTORY.md`). Every line is a noun phrase naming what
 * is on the slide, so the grid reads as one list rather than a mix of labels and
 * instructions.
 */
export const SLIDE_KIND_DESCRIPTIONS: Record<SlideKind, string> = {
  title: "The lesson name and class",
  objectives: "What pupils will learn",
  starter: "Retrieval questions to open the lesson",
  vocabulary: "Terms and their definitions",
  content: "One idea, explained",
  "image-text": "A picture beside the text",
  "worked-example": "A question and the working",
  instructions: "Numbered steps for a task",
  discussion: "A prompt to talk about",
  "true-false": "A statement to mark true or false",
  "multiple-choice": "Four options, one right answer",
  matching: "Terms to match to definitions",
  "image-match": "Words to match to pictures",
  "fill-gap": "A sentence with blanks to fill",
  sort: "Steps to put in order",
  "open-response": "A question and room to answer it",
  "exit-ticket": "Three questions to finish on",
  timer: "A countdown for a task",
  plenary: "What the class has learned",
  blank: "An empty slide",
};

/** Order shown in the picker: the shape of a lesson, then the question types. */
export const SLIDE_KIND_ORDER: SlideKind[] = [
  "title",
  "objectives",
  "starter",
  "vocabulary",
  "content",
  "image-text",
  "worked-example",
  "instructions",
  "discussion",
  "true-false",
  "multiple-choice",
  "matching",
  "image-match",
  "fill-gap",
  "sort",
  "open-response",
  "exit-ticket",
  "timer",
  "plenary",
  "blank",
];
