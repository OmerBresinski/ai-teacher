import type { QuestionData, SlideElement, Theme } from "@tj/domain/documents";
import type { CSSProperties } from "react";
import { ElementBody } from "./ElementBody";
import { type SlideMode, withAlpha } from "./kit";

const EASE = "cubic-bezier(.16,1,.3,1)";
const STAGGER = 40;
/** Delay stops, not items: 6 stops is the 240ms tail SPEC §8 and research/04 §2 specify. */
const STAGGER_CAP = 6;

/**
 * A rect the editor is previewing for an element mid-gesture (drag, resize, rotate). The document
 * in the cache is untouched until pointer-up (ADR 0022 §4); the frame paints from this instead.
 */
export type ElementTransform = {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  /** A group's children scaled with its frame, so the preview and the committed result match. */
  children?: SlideElement[];
};

export type ElementFrameProps = {
  element: SlideElement;
  /** Edit mode only: the in-flight geometry to draw instead of the element's own. */
  override?: ElementTransform;
  theme: Theme;
  mode: SlideMode;
  /** Slide being rendered, threaded to renderers so their writes are addressed. */
  slideId: string;
  /** Reveal step currently displayed. */
  step: number;
  revealAnswer: boolean;
  question?: QuestionData;
  zIndex: number;
  /** Position of this element among those revealed at the same step, for the stagger. */
  staggerIndex?: number;
  /** 1-based correct position on a `sort` question, shown as a badge on reveal. */
  sortIndex?: number;
  /** Position of an `option` element among the slide's options. */
  optionIndex?: number;
  /**
   * False when the reveal must be a cut rather than an entrance: stepping backwards, and
   * inside a group whose own frame is already animating (never two transforms at once).
   */
  animateReveals?: boolean;
  /** Group children are positioned in the group's local space. */
  style?: CSSProperties;
};

/**
 * Positions one element on the slide and owns everything mode-dependent about it:
 * reveal visibility, the entrance animation, the editor's ghost/step badge and the
 * `sort` answer badge. Element renderers stay pure presentation inside it.
 */
export function ElementFrame({
  element,
  theme,
  mode,
  slideId,
  step,
  revealAnswer,
  question,
  zIndex,
  staggerIndex = 0,
  sortIndex,
  optionIndex,
  animateReveals = true,
  style,
  override,
}: ElementFrameProps) {
  const box = override ?? element;
  const rotation = override ? (override.rotation ?? element.rotation) : element.rotation;
  const shown: SlideElement =
    override?.children && element.type === "group"
      ? { ...element, children: override.children }
      : element;
  const revealStep = element.revealStep ?? 0;
  const beyond = revealStep > step;
  const hidden = beyond && mode !== "edit";
  const ghost = beyond && mode === "edit";

  const animates =
    animateReveals &&
    mode === "present" &&
    revealStep > 0 &&
    revealStep === step &&
    element.reveal !== "none";
  const keyframes = element.reveal === "fade" ? "td-reveal-fade" : "td-reveal-rise";
  const delay = Math.min(staggerIndex, STAGGER_CAP) * STAGGER;

  return (
    <div
      data-element-id={element.id}
      data-element-type={element.type}
      aria-hidden={hidden || undefined}
      style={{
        position: "absolute",
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        zIndex,
        opacity: element.opacity ?? 1,
        visibility: hidden ? "hidden" : undefined,
        pointerEvents: hidden ? "none" : undefined,
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        transformOrigin: "center center",
        ...style,
      }}
    >
      {/* The ghost dims the element, never the badge that explains it (SPEC §7). */}
      <div
        data-reveal-anim={animates ? "" : undefined}
        style={{
          width: "100%",
          height: "100%",
          opacity: ghost ? 0.3 : undefined,
          animation: animates ? `${keyframes} 260ms ${EASE} ${delay}ms both` : undefined,
        }}
      >
        <ElementBody
          element={shown}
          theme={theme}
          mode={mode}
          slideId={slideId}
          hidden={hidden}
          ghost={ghost}
          revealAnswer={revealAnswer}
          question={question}
          step={step}
          optionIndex={optionIndex}
        />
      </div>

      {ghost ? <StepBadge theme={theme} step={revealStep} /> : null}
      {revealAnswer && sortIndex != null ? <SortBadge theme={theme} position={sortIndex} /> : null}
    </div>
  );
}

function StepBadge({ theme, step }: { theme: Theme; step: number }) {
  return (
    <span
      style={{
        position: "absolute",
        top: -11,
        right: -11,
        minWidth: 22,
        height: 22,
        padding: "0 6px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 11,
        background: theme.colors.accent,
        color: theme.colors.onAccent,
        border: `1px solid ${withAlpha(theme.colors.background, 0.9)}`,
        fontFamily: theme.fonts.body,
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1,
        letterSpacing: 0,
        pointerEvents: "none",
      }}
    >
      {step}
    </span>
  );
}

function SortBadge({ theme, position }: { theme: Theme; position: number }) {
  return (
    <span
      data-answer-anim=""
      style={{
        position: "absolute",
        top: -14,
        left: -14,
        width: 32,
        height: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 16,
        background: theme.colors.accent,
        color: theme.colors.onAccent,
        fontFamily: theme.fonts.title,
        fontSize: 17,
        fontWeight: 700,
        lineHeight: 1,
        pointerEvents: "none",
      }}
    >
      {position}
    </span>
  );
}
