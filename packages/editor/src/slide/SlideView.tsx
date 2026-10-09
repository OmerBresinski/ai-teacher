import type { QuestionData, Slide, SlideElement, Theme } from "@tj/domain/documents";
import { answerRevealSteps, diagramBuildAt, SLIDE_H, SLIDE_W } from "@tj/domain/documents";
import {
  isDiagramMark,
  slideArtVariant,
  slideBackground,
  withoutDiagramSlot,
  withThemeColours,
} from "@tj/slides";
import {
  type CSSProperties,
  lazy,
  Suspense,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ImageOriginProvider, useResolvedImageSrc } from "../images/image-origin";
import { hasExplanationPanel } from "../layout/explanation";
import { docToPlainText } from "../text/static";
import { choiceMarks } from "./elements/choice";
import { ElementFrame, type ElementTransform } from "./elements/ElementFrame";
import { ExplanationPanel } from "./elements/ExplanationPanel";
import {
  explanationText,
  fontFloor,
  isStatic,
  optionPositions,
  resolveFontSize,
  type SlideMode,
  sortPositions,
  withAlpha,
} from "./elements/kit";
import {
  type AnswerLane,
  answerLane,
  LANE_GAP,
  RULE_GAP,
  RULE_W,
  TICK_D,
  tickSpot,
} from "./reveal-geometry";
import { applySlideClip } from "./slide-clip";

const ExplanationEditor = lazy(() => import("./elements/ExplanationEditor"));

// returns here for the `edit` branch of the "Why?" panel.

export type { SlideMode };

export type SlideViewProps = {
  slide: Slide;
  theme: Theme;
  mode: SlideMode;
  /** Reveal step to display. Elements with revealStep > step are hidden (view/present/capture) or ghosted (edit). */
  step?: number;
  /** Question slides: show the correct answer state. */
  revealAnswer?: boolean;
  /** Wrong options dimmed so far on a choice question, before the answer fills (TEACH-185). */
  answerProgress?: number;
  className?: string;
  /**
   * Edit mode: geometry to paint for elements mid-gesture, keyed by element id. The transform layer
   * previews a drag here and dispatches one reducer on release (ADR 0022 §4), so the cache — and
   * every other subscriber — is untouched while the pointer moves.
   */
  transformOverride?: ReadonlyMap<string, ElementTransform>;
  /**
   * Edit mode: let content past the bottom edge show instead of clipping it. The canvas sets it
   * while a text box is being typed into, so the teacher sees the lines that run off the slide;
   * sideways overflow stays clipped. Ignored in every other mode.
   */
  spill?: boolean;
  /**
   * The api origin stored `/files/<key>` pictures are loaded from (TEACH-275). Set by an entry
   * that mounts a slide outside an `ImageOriginProvider` (the export stage); otherwise inherited.
   */
  imageOrigin?: string;
};

export type { ElementTransform };

const ALL = Number.POSITIVE_INFINITY;

/**
 * The one renderer. Exactly 960x540 logical points in every mode; the parent
 * (SlideScaler) owns the transform, and the editor's selection chrome is a sibling
 * layer, never DOM inside here.
 */
export function SlideView({
  slide: given,
  theme,
  mode,
  step,
  revealAnswer = false,
  answerProgress = 0,
  className,
  transformOverride,
  spill = false,
  imageOrigin,
}: SlideViewProps) {
  /**
   * A diagram instruction with no drawing is a note the editor alone draws: everywhere else the
   * words are laid out as if the slide had no slot, so the right half is never left empty
   * (`@tj/slides` `withoutDiagramSlot`). The editor keeps the placeholder.
   *
   * A picture or diagram brief is a note to the teacher and is never drawn for the class: present,
   * the viewer, thumbnails and capture all lay the words out without the slot. The demo switch
   * (`slot-placeholders.ts`) no longer draws briefs outside the editor.
   */
  const slide = useMemo(
    // Look colours are theme tokens, drawn in the slide's own theme whatever theme wrote them. The
    // editor keeps each text's stored doc: its Tiptap editors save the doc they were given.
    () =>
      mode === "edit"
        ? withThemeColours(given, theme, { docs: false })
        : withThemeColours(withoutDiagramSlot(given, theme), theme),
    [given, theme, mode],
  );
  /**
   * `step` unset means "show the finished slide" — what a thumbnail, an export and the
   * viewer want. In the editor, previewStep 0 also means all visible (SPEC §4); a
   * positive step ghosts everything beyond it.
   */
  const activeStep = step ?? ALL;
  const effectiveStep = mode === "edit" && activeStep === 0 ? ALL : activeStep;

  /**
   * Stepping backwards is a cut, not a replay: an element already on screen must not
   * rise into place again when the teacher presses Left (research/03). The direction is
   * latched with the step it was measured against, so a re-render for any other reason
   * cannot restart an animation that has already been suppressed.
   */
  const [shown, setShown] = useState({ step: effectiveStep, forward: true });
  if (shown.step !== effectiveStep)
    setShown({ step: effectiveStep, forward: effectiveStep > shown.step });
  const forward = shown.step === effectiveStep ? shown.forward : effectiveStep > shown.step;

  /** Position within the group of elements sharing a reveal step, for the stagger. */
  const stagger = useMemo(() => {
    const seen = new Map<number, number>();
    const out = new Map<string, number>();
    for (const el of slide.elements) {
      const s = el.revealStep ?? 0;
      const n = seen.get(s) ?? 0;
      seen.set(s, n + 1);
      out.set(el.id, n);
    }
    return out;
  }, [slide.elements]);

  const sortIndex = useMemo(() => sortPositions(slide), [slide]);
  const optionIndex = useMemo(() => optionPositions(slide), [slide]);
  const explanation = revealAnswer ? explanationText(slide.question) : null;
  /**
   * True-false and multiple choice get the "Why?" panel (Chalkie inventory line
   * 10). In the editor it is drawn even when empty, so there is somewhere to type;
   * everywhere else an unwritten reason is simply not shown.
   */
  const panel = revealAnswer && hasExplanationPanel(slide.question);
  const lane = useMemo(() => {
    if (!explanation || panel) return null;
    const base = resolveFontSize(theme, "small");
    const floor = fontFloor("small");
    const stepped = Math.max(floor, Math.round(base * 0.86));
    return answerLane(slide, explanation, { base, stepped, floor }, theme.lineHeights.small);
  }, [slide, theme, explanation, panel]);

  const bg = slide.background;
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (mode === "edit" && root.current) applySlideClip(root.current, spill);
  }, [mode, spill]);
  const rootStyle: CSSProperties = {
    position: "relative",
    width: SLIDE_W,
    height: SLIDE_H,
    // In the editor the root must not be a scroll container (`hidden` let Chromium caret-scroll it
    // while typing past the bottom edge), so edit mode rewrites this to `clip` before paint with
    // `applySlideClip`, opening the bottom edge while a box is being typed into (`spill`). Every
    // other mode keeps `hidden`.
    overflow: "hidden",
    background: bg?.color ?? theme.colors.background,
    color: theme.colors.ink,
    fontFamily: theme.fonts.body,
    fontWeight: theme.weights.body,
    transformOrigin: "top left",
    // Theme tokens the stylesheet reads (bullets, marks, selection, gaps).
    ["--td-ink" as string]: theme.colors.ink,
    ["--td-muted" as string]: theme.colors.muted,
    ["--td-accent" as string]: theme.colors.accent,
    ["--td-accent2" as string]: theme.colors.accent2,
    ["--td-on-accent" as string]: theme.colors.onAccent,
    ["--td-accent-soft" as string]: withAlpha(theme.colors.accent, 0.18),
    ["--td-line" as string]: theme.colors.line,
    ["--td-surface" as string]: theme.colors.surface,
    ...(mode === "thumb"
      ? { contentVisibility: "auto", containIntrinsicSize: `${SLIDE_W}px ${SLIDE_H}px` }
      : null),
  };

  // capture, thumb and print render the finished state instantly: no reveal, no answer
  // fade, no drawn lines. `no-anim` is belt and braces over the mode-scoped CSS.
  const still = isStatic(mode);
  const rootClass = [className, still ? "no-anim" : null].filter(Boolean).join(" ") || undefined;

  return (
    <ImageOriginProvider origin={imageOrigin}>
      <div
        ref={root}
        data-slide-root
        data-slide-id={slide.id}
        data-slide-mode={mode}
        data-marker={theme.ornament?.marker}
        className={rootClass}
        style={rootStyle}
      >
        <SlideBackground theme={theme} slide={slide} />

        {slide.elements.map((el, i) =>
          // A diagram placeholder is a note to the teacher: drawn in the editor, never in present,
          // export, print or a thumbnail (`@tj/slides` `withDiagramSlot`).
          (isDiagramMark(el) && mode !== "edit") || el.id === lane?.replaces ? null : (
            <ElementFrame
              key={el.id}
              element={el}
              theme={theme}
              mode={mode}
              slideId={slide.id}
              step={effectiveStep}
              revealAnswer={revealAnswer}
              answerProgress={answerProgress}
              diagramBuild={
                mode === "present" && step !== undefined ? diagramBuildAt(slide, step) : undefined
              }
              diagramAnswer={
                mode === "present"
                  ? !slide.question || answerRevealSteps(slide) === 0 || revealAnswer
                  : undefined
              }
              question={slide.question}
              zIndex={i + 1}
              staggerIndex={stagger.get(el.id)}
              sortIndex={sortIndex.get(el.id)}
              optionIndex={optionIndex.get(el.id)}
              animateReveals={forward}
              override={mode === "edit" ? transformOverride?.get(el.id) : undefined}
            />
          ),
        )}

        {revealAnswer && slide.question?.type === "matching" ? (
          <MatchingLines slide={slide} theme={theme} question={slide.question} animate={!still} />
        ) : null}

        {slide.question?.type === "multiple-choice" ? (
          <ChoiceMarks
            slide={slide}
            theme={theme}
            revealAnswer={revealAnswer}
            answerProgress={answerProgress ?? 0}
          />
        ) : null}

        {revealAnswer && slide.question?.type === "image-match" ? (
          <ImageMatchAnswers slide={slide} theme={theme} question={slide.question} />
        ) : null}

        {panel ? (
          mode === "edit" ? (
            <Suspense
              fallback={
                <ExplanationPanel
                  slide={slide}
                  theme={theme}
                  text={explanation ?? ""}
                  mode={mode}
                />
              }
            >
              <ExplanationEditor slide={slide} theme={theme} text={explanation ?? ""} />
            </Suspense>
          ) : explanation ? (
            <ExplanationPanel slide={slide} theme={theme} text={explanation} mode={mode} />
          ) : null
        ) : explanation && lane ? (
          <Explanation theme={theme} text={explanation} lane={lane} />
        ) : null}
      </div>
    </ImageOriginProvider>
  );
}

/* ------------------------------------------------------------------ */
/* Background                                                          */
/* ------------------------------------------------------------------ */

function SlideBackground({ theme, slide }: { theme: Theme; slide: Slide }) {
  const background = slide.background;
  const image = useResolvedImageSrc(background?.image ?? "") || undefined;
  // `slideBackground` is the one rule the PowerPoint export reads too (UX ruling 107): the theme's
  // art for the slide's role, clear of its elements; none under a colour or image the teacher chose.
  const themeImage = image ? undefined : slideBackground(theme, slide);
  if (!image && !themeImage) return null;
  return (
    <div
      aria-hidden
      // The export paint gate (`waitForSlidePaint`) cannot see a CSS background through `<img>`
      // queries; it reads this attribute and preloads the picture before printing or capturing.
      data-background-image={image}
      // Which theme art variant is drawn (UX ruling 107), for tests and the export's paint gate.
      data-theme-art={themeImage ? slideArtVariant(slide) : undefined}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 0,
        ...(image
          ? {
              backgroundImage: `url(${JSON.stringify(image)})`,
              backgroundSize: background?.imageFit ?? "cover",
              backgroundPosition: "center",
              backgroundRepeat: "no-repeat",
            }
          : { background: themeImage }),
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Question reveal chrome                                              */
/* ------------------------------------------------------------------ */

/**
 * Reveal copy, always whole (TEACH-101 part d): in the lowest free lane on the slide, beside
 * pictures if it must, or in the instruction line's place, stepping down to the floor before it
 * gives up a lane (`answerLane`). It never overlaps another box and never moves one. When no lane
 * holds it, the reveal is its own state: the body is washed back and the answer set large under the
 * heading. Never clipped (research/04 §4).
 */
function Explanation({ theme, text, lane }: { theme: Theme; text: string; lane: AnswerLane }) {
  const lineHeight = theme.lineHeights.small;
  const stage = lane.mode === "stage";
  return (
    <>
      {stage ? (
        <div
          aria-hidden
          data-answer-anim=""
          data-answer-wash=""
          style={{
            position: "absolute",
            left: 0,
            top: lane.y - LANE_GAP,
            width: SLIDE_W,
            height: SLIDE_H - lane.y + LANE_GAP,
            background: withAlpha(theme.colors.background, 0.97),
            zIndex: 899,
          }}
        />
      ) : null}
      <div
        data-answer-anim=""
        data-answer-lane={stage ? "stage" : lane.replaces ? "replaces-instruction" : "free"}
        style={{
          position: "absolute",
          left: lane.x,
          top: lane.y,
          width: lane.w,
          minHeight: stage ? lane.h : undefined,
          display: "flex",
          alignItems: stage ? "center" : undefined,
          gap: RULE_GAP,
          zIndex: 900,
        }}
      >
        <span
          aria-hidden
          style={{
            flex: `0 0 ${RULE_W}px`,
            width: RULE_W,
            alignSelf: "stretch",
            background: theme.colors.accent,
            borderRadius: 2,
          }}
        />
        <p
          style={{
            margin: 0,
            whiteSpace: "pre-line",
            fontFamily: theme.fonts.body,
            fontSize: lane.size,
            lineHeight,
            fontWeight: theme.weights.body,
            color: theme.colors.ink,
          }}
        >
          {text}
        </p>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Matching lines                                                      */
/* ------------------------------------------------------------------ */

type Placed = { id: string; x: number; y: number; w: number; h: number };

/** Every element with its position in slide space, groups walked and offsets accumulated. */
function placedById(elements: readonly SlideElement[]): Map<string, Placed> {
  const out = new Map<string, Placed>();
  const walk = (els: readonly SlideElement[], dx: number, dy: number) => {
    for (const el of els) {
      out.set(el.id, { id: el.id, x: el.x + dx, y: el.y + dy, w: el.w, h: el.h });
      if (el.type === "group") walk(el.children, el.x + dx, el.y + dy);
    }
  };
  walk(elements, 0, 0);
  return out;
}

/**
 * The choice reveal for cards and option boxes (template hinge, choose, odd one out): each wrong
 * card is washed back in turn, then the right one is ringed with a tick, over the whole card so
 * its picture dims with its word. `option` elements draw their own (`OptionView`).
 */
function ChoiceMarks({
  slide,
  theme,
  revealAnswer,
  answerProgress,
}: {
  slide: Slide;
  theme: Theme;
  revealAnswer: boolean;
  answerProgress: number;
}) {
  const marks = useMemo(
    () => choiceMarks(slide, revealAnswer, answerProgress),
    [slide, revealAnswer, answerProgress],
  );
  if (marks.length === 0) return null;
  const placed = placedById(slide.elements);
  return (
    <>
      {marks.map(({ id, state }) => {
        const r = placed.get(id);
        if (!r) return null;
        const right = state === "right";
        const tick = right ? tickSpot(slide, r) : null;
        return (
          <div
            key={id}
            data-answer-anim=""
            data-choice-mark={state}
            style={{
              position: "absolute",
              left: r.x,
              top: r.y,
              width: r.w,
              height: r.h,
              zIndex: 800,
              pointerEvents: "none",
              borderRadius: Math.min(theme.radius, 16),
              background: right ? undefined : withAlpha(theme.colors.background, 0.62),
              boxShadow: right ? `0 0 0 4px ${theme.colors.correct}` : undefined,
            }}
          >
            {right ? (
              <span
                role="img"
                aria-label="Correct answer"
                data-tick-spot=""
                style={{
                  position: "absolute",
                  left: tick?.left,
                  top: tick?.top,
                  width: TICK_D,
                  height: TICK_D,
                  borderRadius: TICK_D,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: theme.colors.correct,
                  color: theme.colors.surface,
                  fontWeight: 700,
                  fontSize: 22,
                  lineHeight: 1,
                }}
              >
                ✓
              </span>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/** `matching` reveal: one line per pair, drawn between the two cards. */
function MatchingLines({
  slide,
  theme,
  question,
  animate,
}: {
  slide: Slide;
  theme: Theme;
  question: Extract<QuestionData, { type: "matching" }>;
  animate: boolean;
}) {
  const pairs = useMemo(() => {
    const byId = placedById(slide.elements);
    return question.pairs
      .map((p) => ({ id: p.id, a: byId.get(p.leftElementId), b: byId.get(p.rightElementId) }))
      .filter((p): p is { id: string; a: Placed; b: Placed } => !!p.a && !!p.b);
  }, [slide.elements, question.pairs]);

  if (pairs.length === 0) return null;

  return (
    <svg
      width={SLIDE_W}
      height={SLIDE_H}
      viewBox={`0 0 ${SLIDE_W} ${SLIDE_H}`}
      aria-hidden
      focusable="false"
      style={{ position: "absolute", inset: 0, zIndex: 800, pointerEvents: "none" }}
    >
      {pairs.map((p, i) => {
        const leftFirst = p.a.x <= p.b.x;
        const from = leftFirst ? p.a : p.b;
        const to = leftFirst ? p.b : p.a;
        const x1 = from.x + from.w;
        const y1 = from.y + from.h / 2;
        const x2 = to.x;
        const y2 = to.y + to.h / 2;
        const len = Math.round(Math.hypot(x2 - x1, y2 - y1));
        return (
          <g key={p.id}>
            <line
              className="td-match-line"
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={theme.colors.accent}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeDasharray={animate ? len : undefined}
              style={
                animate
                  ? {
                      ["--td-len" as string]: String(len),
                      animation: `td-draw-line 340ms cubic-bezier(.16,1,.3,1) ${i * 60}ms both`,
                    }
                  : undefined
              }
            />
            <circle cx={x1} cy={y1} r={4.5} fill={theme.colors.accent} />
            <circle cx={x2} cy={y2} r={4.5} fill={theme.colors.accent} />
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Image matching answers                                             */
/* ------------------------------------------------------------------ */

/** Vertical breathing room the answer card takes beyond the word box it covers. */
const ANSWER_PAD = 6;

/**
 * `image-match` reveal: the word that belongs under each picture, drawn on a card
 * over the slot beneath it.
 *
 * The card sits in the slot under its own picture, not on the box the pair points
 * at: the pair names the *right* word, and the point of the slide is that it starts
 * somewhere else. Reading the slot's own rect means the card lands on the word it
 * replaces even after the fitting engine has resized it.
 *
 * Pictures and slots are each sorted by centre x and zipped by index, so the
 * mapping is a bijection. Picking each picture's nearest slot independently is not:
 * on an uneven row two pictures can choose the same word box, one card covering the
 * other and a third slot left showing the shuffled word.
 */
function ImageMatchAnswers({
  slide,
  theme,
  question,
}: {
  slide: Slide;
  theme: Theme;
  question: Extract<QuestionData, { type: "image-match" }>;
}) {
  const cards = useMemo(() => {
    const placed = placedById(slide.elements);
    const byId = new Map(slide.elements.map((el) => [el.id, el]));
    const centreX = (r: Placed) => r.x + r.w / 2;

    // A pair only counts when both ends are on the slide and the word says
    // something; dropping one takes its slot out of the pool with it, so the two
    // orders stay the same length and the zip stays aligned.
    const entries = question.pairs.flatMap((pair) => {
      const image = placed.get(pair.imageId);
      const slot = placed.get(pair.labelId);
      const word = byId.get(pair.labelId);
      if (!image || !slot || !word || word.type !== "text") return [];
      const label = docToPlainText(word.doc).trim();
      if (!label) return [];
      return [{ pair, image, slot, word, label }];
    });
    if (entries.length === 0) return [];

    const slots = entries.map((e) => e.slot).sort((a, b) => centreX(a) - centreX(b));
    const byPicture = [...entries].sort((a, b) => centreX(a.image) - centreX(b.image));

    return byPicture.flatMap(({ pair, word, label }, i) => {
      const slot = slots[i];
      if (!slot) return [];
      return [
        {
          id: pair.id,
          label,
          fontSize: resolveFontSize(theme, word.style.preset, word.style.fontSize),
          lineHeight: word.style.lineHeight ?? theme.lineHeights[word.style.preset],
          x: slot.x,
          y: Math.max(0, slot.y - ANSWER_PAD),
          w: slot.w,
          h: Math.min(SLIDE_H - Math.max(0, slot.y - ANSWER_PAD), slot.h + ANSWER_PAD * 2),
        },
      ];
    });
  }, [slide.elements, question.pairs, theme]);

  if (cards.length === 0) return null;

  return (
    <>
      {cards.map((card) => (
        <div
          key={card.id}
          data-answer-anim=""
          style={{
            position: "absolute",
            left: card.x,
            top: card.y,
            width: card.w,
            height: card.h,
            zIndex: 800,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            padding: "0 10px",
            borderRadius: theme.radius,
            // Opaque: the card covers the word that was in this slot before the reveal.
            background: theme.colors.surface,
            boxShadow: `0 0 0 2px ${theme.colors.correct}`,
          }}
        >
          <span
            style={{
              fontFamily: theme.fonts.body,
              fontSize: card.fontSize,
              lineHeight: card.lineHeight,
              fontWeight: 600,
              color: theme.colors.correct,
              textAlign: "center",
            }}
          >
            {card.label}
          </span>
        </div>
      ))}
    </>
  );
}
