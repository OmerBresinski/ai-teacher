import { SLIDE_H, type Slide, type Theme } from "@tj/domain/documents";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  EXPLANATION_HEADING,
  EXPLANATION_PLACEHOLDER,
  type ExplanationBox,
  explanationLayout,
  PANEL,
} from "../../layout/explanation";
import { type SlideMode, withAlpha } from "./kit";
import { OverflowGlyph } from "./TextView";

export type { ExplanationBox };
export { explanationLayout };

/**
 * The "Why?" panel under the answer cards on a true-false or multiple-choice
 * slide (Chalkie inventory line 10). It is slide content, not editor chrome: it
 * is drawn in the 960x540 space at a box `lib/layout/explanation.ts` works out,
 * so present mode, the print route and a PNG capture all get the same panel the
 * editor showed.
 *
 * It is only ever mounted in the answer state. In the question state the caller
 * does not render it at all — there is nothing to hide, and nothing to read out.
 *
 * The card is anchored by its *bottom*, at the foot of the safe area, and sized
 * `height: auto` between the ruler's height and the whole lane. The ruler is
 * measurement-free by design, so on a long line of Lexend it can be a line out;
 * anchoring this way round means real text grows into room that genuinely exists
 * rather than being clipped to a prediction, while the reserve maths still
 * guarantees the minimum. Whether the text really is clipped is then read off the
 * rendered box rather than off the ruler.
 */
export function ExplanationPanel({
  slide,
  theme,
  text,
  mode,
  box,
  /** The editable body, when the teacher is typing into the panel. */
  editorSlot,
  /** A note under the field while the teacher is typing. Editor only. */
  hint,
}: {
  slide: Slide;
  theme: Theme;
  /** The reason as written. Empty in the editor means "show the placeholder". */
  text: string;
  mode: SlideMode;
  /** Precomputed geometry, so an editor and its resting panel cannot disagree. */
  box?: ExplanationBox;
  editorSlot?: ReactNode;
  hint?: string;
}) {
  const empty = text.trim().length === 0;
  const layout =
    box ?? explanationLayout({ slide, theme, text: empty ? EXPLANATION_PLACEHOLDER : text });
  const card = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);

  // Does the text really overrun the box it got? Read from the rendered node, so
  // a ruler that under-counted a line cannot hide a clipped reason, and one that
  // over-counted cannot invent one.
  // The layout numbers are dependencies on purpose: the box re-measures when they move.
  // biome-ignore lint/correctness/useExhaustiveDependencies: text and layout drive the re-measure
  useEffect(() => {
    const el = card.current;
    if (mode !== "edit" || !el) return;
    const check = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode, text, layout.h, layout.lane, layout.bodySize]);

  // Too little room left under the cards to draw a panel at all. Outside the
  // editor that means silence; inside it the teacher gets told, but only when
  // there is a reason to lose. An empty panel on an older lesson is not a problem
  // anyone has, and a red glyph with no text behind it cannot be acted on.
  if (layout.collapsed) {
    if (mode !== "edit" || empty) return null;
    return (
      <div
        style={{
          position: "absolute",
          left: layout.x,
          top: layout.y - 22,
          width: layout.w,
          height: 22,
        }}
      >
        <OverflowGlyph
          theme={theme}
          title="There is no room under the answers for this reason. Tidy will not move the cards up."
        />
      </div>
    );
  }

  return (
    <>
      <div
        ref={card}
        data-answer-anim=""
        data-explanation-panel=""
        style={{
          position: "absolute",
          left: layout.x,
          // Anchored by the foot of the safe area: the panel grows upward into
          // whatever lane it has, so text the ruler under-counted still lands.
          bottom: SLIDE_H - (layout.y + layout.h),
          width: layout.w,
          height: "auto",
          minHeight: layout.h,
          maxHeight: layout.lane,
          boxSizing: "border-box",
          padding: `${PANEL.padY}px ${PANEL.padX}px`,
          overflow: "hidden",
          background: theme.colors.surface,
          border: `1px solid ${theme.colors.line}`,
          borderRadius: theme.radius,
          // A quiet surface, not a second accent: the tint is the theme's own
          // accent at 6%, which reads as a change of paper rather than a badge.
          backgroundImage: `linear-gradient(${withAlpha(theme.colors.accent, 0.06)}, ${withAlpha(theme.colors.accent, 0.06)})`,
          zIndex: 900,
        }}
      >
        <p
          style={{
            margin: 0,
            fontFamily: theme.fonts.title,
            fontSize: layout.headingSize,
            lineHeight: theme.lineHeights.heading,
            fontWeight: theme.weights.heading,
            letterSpacing: theme.titleTracking,
            color: theme.colors.accent,
          }}
        >
          {EXPLANATION_HEADING}
        </p>
        <div style={{ height: PANEL.gap }} />
        {editorSlot ?? (
          <p
            style={{
              margin: 0,
              fontFamily: theme.fonts.body,
              fontSize: layout.bodySize,
              lineHeight: theme.lineHeights.body,
              fontWeight: theme.weights.body,
              color: empty ? theme.colors.muted : theme.colors.ink,
              whiteSpace: "pre-wrap",
            }}
          >
            {empty ? EXPLANATION_PLACEHOLDER : text}
          </p>
        )}
        {clipped && mode === "edit" ? (
          <OverflowGlyph
            theme={theme}
            title="This reason is longer than the room under the answers."
          />
        ) : null}
      </div>
      {/* Under the field, not inside it. The lane is exactly as tall as the reason
          it promised, so a note drawn inside the card would push the reason out of
          its own room and then report itself as an overflow. */}
      {hint ? (
        <p
          style={{
            position: "absolute",
            left: layout.x,
            top: layout.y + layout.h + 6,
            width: layout.w,
            margin: 0,
            fontFamily: theme.fonts.body,
            fontSize: 15,
            lineHeight: 1.3,
            color: theme.colors.muted,
            zIndex: 900,
          }}
        >
          {hint}
        </p>
      ) : null}
    </>
  );
}
