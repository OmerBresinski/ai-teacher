import type { QuestionData, Slide, SlideElement, Theme } from "@tj/domain/documents";
import { SLIDE_H, SLIDE_W } from "@tj/domain/documents";
import { type CSSProperties, lazy, Suspense, useMemo, useState } from "react";
import { hasExplanationPanel } from "../layout/explanation";
import { SAFE } from "../model/grid";
import { docToPlainText } from "../text/static";
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
import { OverflowGlyph } from "./elements/TextView";

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
  className?: string;
  /**
   * Edit mode: geometry to paint for elements mid-gesture, keyed by element id. The transform layer
   * previews a drag here and dispatches one reducer on release (ADR 0022 §4), so the cache — and
   * every other subscriber — is untouched while the pointer moves.
   */
  transformOverride?: ReadonlyMap<string, ElementTransform>;
};

export type { ElementTransform };

const ALL = Number.POSITIVE_INFINITY;

/**
 * The one renderer. Exactly 960x540 logical points in every mode; the parent
 * (SlideScaler) owns the transform, and the editor's selection chrome is a sibling
 * layer, never DOM inside here.
 */
export function SlideView({
  slide,
  theme,
  mode,
  step,
  revealAnswer = false,
  className,
  transformOverride,
}: SlideViewProps) {
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

  const bg = slide.background;
  const rootStyle: CSSProperties = {
    position: "relative",
    width: SLIDE_W,
    height: SLIDE_H,
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
    <div
      data-slide-root
      data-slide-id={slide.id}
      data-slide-mode={mode}
      className={rootClass}
      style={rootStyle}
    >
      <SlideBackground theme={theme} background={bg} />

      {slide.elements.map((el, i) => (
        <ElementFrame
          key={el.id}
          element={el}
          theme={theme}
          mode={mode}
          slideId={slide.id}
          step={effectiveStep}
          revealAnswer={revealAnswer}
          question={slide.question}
          zIndex={i + 1}
          staggerIndex={stagger.get(el.id)}
          sortIndex={sortIndex.get(el.id)}
          optionIndex={optionIndex.get(el.id)}
          animateReveals={forward}
          override={mode === "edit" ? transformOverride?.get(el.id) : undefined}
        />
      ))}

      {revealAnswer && slide.question?.type === "matching" ? (
        <MatchingLines slide={slide} theme={theme} question={slide.question} animate={!still} />
      ) : null}

      {revealAnswer && slide.question?.type === "image-match" ? (
        <ImageMatchAnswers slide={slide} theme={theme} question={slide.question} />
      ) : null}

      {panel ? (
        mode === "edit" ? (
          <Suspense
            fallback={
              <ExplanationPanel slide={slide} theme={theme} text={explanation ?? ""} mode={mode} />
            }
          >
            <ExplanationEditor slide={slide} theme={theme} text={explanation ?? ""} />
          </Suspense>
        ) : explanation ? (
          <ExplanationPanel slide={slide} theme={theme} text={explanation} mode={mode} />
        ) : null
      ) : explanation ? (
        <Explanation slide={slide} theme={theme} text={explanation} mode={mode} />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Background                                                          */
/* ------------------------------------------------------------------ */

function SlideBackground({ theme, background }: { theme: Theme; background: Slide["background"] }) {
  const image = background?.image;
  // A slide's own background wins outright: theme art must never paint over a colour
  // the teacher chose, or there would be no way to switch it off.
  const themeImage = background?.color || image ? undefined : theme.backgroundImage;
  if (!image && !themeImage) return null;
  return (
    <div
      aria-hidden
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

const bottomOf = (el: SlideElement) => el.y + el.h;

/** Gap between the lowest card and the explanation, and the smallest lane worth having. */
const EXPLANATION_GAP = 19;
const EXPLANATION_MIN_LANE = 48;
const RULE_W = 3;

/**
 * Reveal copy, under the options. Never overlaps them and never moves a card — and when
 * the lane is too short for the copy it steps the type down one stop and, failing that,
 * warns the author in edit mode rather than truncating in silence (research/04 §4).
 */
function Explanation({
  slide,
  theme,
  text,
  mode,
}: {
  slide: Slide;
  theme: Theme;
  text: string;
  mode: SlideMode;
}) {
  const options = slide.elements.filter((e) => e.type === "option");
  const anchors = options.length > 0 ? options : slide.elements;
  const below = anchors.reduce<number>((m, e) => Math.max(m, bottomOf(e)), SAFE.y);
  const top = Math.min(below + EXPLANATION_GAP, SLIDE_H - SAFE.y - EXPLANATION_MIN_LANE);
  const available = SLIDE_H - SAFE.y - top;

  const lineHeight = theme.lineHeights.small;
  const width = SAFE.w - RULE_W - EXPLANATION_GAP;
  // Deterministic in every mode: no measurement, so capture and SSR agree with the
  // editor. ~0.5em average advance is close enough to pick a stop.
  const heightAt = (size: number) =>
    Math.ceil(
      Math.max(1, Math.ceil(text.length / Math.max(1, Math.floor(width / (size * 0.5))))) *
        size *
        lineHeight,
    );

  const base = resolveFontSize(theme, "small");
  const floor = fontFloor("small");
  const stepped = Math.max(floor, Math.round(base * 0.86));
  const size = heightAt(base) <= available ? base : stepped;
  const overflowing = heightAt(size) > available;

  return (
    <div
      data-answer-anim=""
      style={{
        position: "absolute",
        left: SAFE.x,
        top,
        width: SAFE.w,
        maxHeight: available,
        overflow: "hidden",
        display: "flex",
        gap: EXPLANATION_GAP,
        zIndex: 900,
      }}
    >
      <span
        aria-hidden
        style={{
          flex: `0 0 ${RULE_W}px`,
          width: RULE_W,
          background: theme.colors.accent,
          borderRadius: 2,
        }}
      />
      <p
        style={{
          margin: 0,
          fontFamily: theme.fonts.body,
          fontSize: size,
          lineHeight,
          fontWeight: theme.weights.body,
          color: theme.colors.ink,
        }}
      >
        {text}
      </p>
      {overflowing && mode === "edit" ? (
        <OverflowGlyph
          theme={theme}
          title="This explanation is longer than the room under the options."
        />
      ) : null}
    </div>
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
