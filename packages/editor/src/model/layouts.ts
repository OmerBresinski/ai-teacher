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
import { SLIDE_H, SLIDE_W } from "@tj/domain/documents";
import { explanationReserve, RESERVED_LINES } from "../layout/explanation";
import { OPTION } from "../layout/reflow";
import { docFromBullets, docFromText, newText, uid } from "./factories";
import { BASELINE, colLeft, GUTTER, SAFE, SPACE, snapY, spanWidth } from "./grid";
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

/** Title — left-aligned stack, optically centred, accent rule above the eyebrow. */
function titleSlide(t: Theme): Layout {
  const capH = boxH(t, "caption");
  const titleH = boxH(t, "title", 2);
  const subH = boxH(t, "subtitle");
  const top = centreY(capH + 12 + titleH + 17 + subH);
  return {
    elements: [
      shape(
        "rect",
        { x: SAFE.x, y: top - 29, w: 67, h: 4 },
        { fill: t.colors.accent, name: "Accent rule" },
      ),
      text("caption", "LESSON", { x: SAFE.x, y: top, w: FULL, h: capH }, { color: t.colors.muted }),
      text("title", "Lesson title", { x: SAFE.x, y: top + capH + 12, w: spanWidth(11), h: titleH }),
      text(
        "subtitle",
        "Year group and class",
        { x: SAFE.x, y: top + capH + 12 + titleH + 17, w: spanWidth(9), h: subH },
        { color: t.colors.muted },
      ),
    ],
  };
}

/** Learning objectives — heading, hairline, three numbered objectives. */
function objectivesSlide(t: Theme): Layout {
  return {
    elements: [
      ...headed(t, "Learning objectives"),
      numberedBody(t, [
        "Learning objective one",
        "Learning objective two",
        "Learning objective three",
      ]),
    ],
  };
}

/** Do now — retrieval questions and a time cue. */
function starterSlide(t: Theme): Layout {
  return {
    elements: [
      ...headed(t, "Do now"),
      numberedBody(t, [
        "Recall question from last lesson",
        "Recall question from last term",
        "Stretch question",
      ]),
      footnote(t, "5 minutes. Work in silence and answer in your book."),
    ],
  };
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
  const capH = boxH(t, "caption");
  const top = BODY_Y;
  return {
    elements: [
      ...headed(t, "Worked example"),
      text(
        "caption",
        "QUESTION",
        { x: SAFE.x, y: top, w: HALF_W, h: capH },
        { color: t.colors.muted },
      ),
      text("body", "Write the question exactly as pupils will see it.", {
        x: SAFE.x,
        y: top + capH + 12,
        w: HALF_W,
        h: boxH(t, "body", 4),
      }),
      shape(
        "rounded",
        { x: RIGHT_X, y: top, w: HALF_W, h: SAFE_BOTTOM - top },
        { fill: t.colors.surface, radius: t.radius, name: "Working card" },
      ),
      text(
        "caption",
        "WORKING",
        { x: RIGHT_X + 24, y: top + 24, w: HALF_W - 48, h: capH },
        { color: t.colors.muted },
      ),
      text(
        "body",
        docFromNumbered(["First step, and why", "Second step, and why", "The answer"]),
        { x: RIGHT_X + 24, y: top + 24 + capH + 12, w: HALF_W - 48, h: boxH(t, "body", 4.8) },
        {},
        { revealStep: 1, reveal: "rise" },
      ),
    ],
  };
}

/** Instructions — the task, numbered steps, and how long it takes. */
function instructionsSlide(t: Theme): Layout {
  return {
    elements: [
      ...headed(t, "Task"),
      numberedBody(t, [
        "What to do first",
        "What to do next",
        "Where to write your answer",
        "If you finish early, extend it",
      ]),
      footnote(t, "10 minutes. Work quietly."),
    ],
  };
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
  return {
    elements: [
      ...headed(t, "Exit ticket"),
      numberedBody(t, [
        "One thing you learnt today",
        "One question you still have",
        "One word that sums this up",
      ]),
      footnote(t, "Answer on a sticky note and hand it to me on the way out"),
    ],
  };
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
  const items = [
    "Something we can now explain",
    "Something we can now do",
    "Something to practise next lesson",
  ];
  return {
    elements: [
      ...headed(t, "What have we learned?"),
      text("body", docFromBullets(items), {
        x: SAFE.x,
        y: BODY_Y,
        w: spanWidth(10),
        h: boxH(t, "body", items.length * 1.6),
      }),
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function layoutSlide(kind: SlideKind, themeId: string): Layout {
  const t = getTheme(themeId);
  switch (kind) {
    case "blank":
      return { elements: [] };
    case "title":
      return titleSlide(t);
    case "objectives":
      return objectivesSlide(t);
    case "starter":
      return starterSlide(t);
    case "vocabulary":
      return vocabularySlide(t);
    case "content":
      return contentSlide(t);
    case "image-text":
      return imageTextSlide(t);
    case "worked-example":
      return workedExampleSlide(t);
    case "instructions":
      return instructionsSlide(t);
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
      return exitTicketSlide(t);
    case "timer":
      return timerSlide(t);
    case "plenary":
      return plenarySlide(t);
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
