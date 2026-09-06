import type { OptionElement } from "@tj/domain/documents";
import { Check } from "lucide-react";
import { lazy, type ReactNode, Suspense } from "react";
import { docToPlainText } from "../../text/static";
import {
  type ElementViewProps,
  optionState,
  resolveTextStyle,
  textTypeCss,
  withAlpha,
} from "./kit";
import { RichText } from "./RichText";

/**
 * Edit mode only: the store subscription and, behind another lazy boundary, Tiptap. The
 * viewer, present, capture and thumb bundles carry neither.
 */
const EditableLabel = lazy(() => import("./EditableLabel"));

const PAD = 24;
const CHIP = 34;
const CHIP_GAP = 19;
const TICK_LANE = 44;
/** The corner badge and its inset from the card's top-right corner. */
const BADGE = 32;
const BADGE_INSET = 10;

/**
 * An answer card. Geometry is fixed at rest and on reveal — the card is `border-box` and
 * the tick lane is reserved up front, so nothing on the slide moves when the answer
 * appears (research/04 §4). Correctness is the theme's `correct` colour plus a tick, so
 * it is never signalled by colour alone (SPEC §6, research/04 §3). The tick is a badge
 * in the card's top-right corner, as Chalkie draws it
 * (`docs/reference/chalkie/11-...png`), but inside the slide's own coordinate space, so
 * an export and a projector show the same card the editor did. The lane it sits in stays
 * reserved: the badge moved, the geometry did not.
 *
 * Double-clicking the card in edit mode types into it: the editor takes the text slot
 * inside the card, after the label chip, so the card itself never changes shape.
 */
export function OptionView({
  element,
  theme,
  mode,
  slideId,
  revealAnswer,
  question,
  optionIndex,
}: ElementViewProps<OptionElement>) {
  const text = docToPlainText(element.doc);
  const state = optionState(element, question, text, optionIndex);
  const scorable = question?.type === "multiple-choice" || question?.type === "true-false";
  const showing = revealAnswer && state !== null;

  const correct = showing && state === "correct";
  const wrong = showing && state === "incorrect";

  // research/04 §4 sets option cards at small/1.35, tighter than the theme's body copy.
  // The `option` role carries the 31pt projector floor the `small` stop does not.
  const r = resolveTextStyle(
    { preset: "small", valign: "middle", lineHeight: 1.35, ...element.textStyle },
    theme,
    element.textStyle?.preset ?? "small",
    "option",
  );

  const correctColor = theme.colors.correct;

  // A chip is a position marker (A, B, T). When it just repeats the card's own words —
  // a `true-false` card labelled "True" — it is noise, and on a narrow card the two
  // collide. Drop it and let the text speak.
  const label =
    element.label && element.label.trim().toLowerCase() !== text.trim().toLowerCase()
      ? element.label
      : null;

  /** The one card, drawn either with its rendered text or with the editor in that slot. */
  const card = (editor: ReactNode) => (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        gap: CHIP_GAP,
        padding: PAD,
        paddingRight: scorable ? PAD + TICK_LANE : PAD,
        boxSizing: "border-box",
        background: correct ? withAlpha(correctColor, 0.1) : theme.colors.surface,
        border: `${correct ? 2 : 1.5}px solid ${correct ? correctColor : theme.colors.line}`,
        borderRadius: theme.radius,
        opacity: wrong ? 0.45 : 1,
        transition:
          "opacity 200ms cubic-bezier(.16,1,.3,1), background 200ms cubic-bezier(.16,1,.3,1)",
      }}
    >
      {label ? (
        <span
          aria-hidden
          style={{
            flex: `0 0 ${CHIP}px`,
            width: CHIP,
            height: CHIP,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 10,
            background: withAlpha(
              correct ? correctColor : theme.colors.accent,
              correct ? 0.22 : 0.12,
            ),
            color: correct ? correctColor : theme.colors.accent,
            fontFamily: theme.fonts.title,
            fontWeight: 700,
            fontSize: 19,
            lineHeight: 1,
            letterSpacing: 0,
          }}
        >
          {label}
        </span>
      ) : null}

      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        {editor ?? <RichText doc={element.doc} style={textTypeCss(r)} />}
      </div>

      {correct ? (
        <span
          role="img"
          aria-label="Correct answer"
          style={{
            position: "absolute",
            right: BADGE_INSET,
            top: BADGE_INSET,
            display: "flex",
          }}
        >
          <span
            data-answer-anim=""
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: BADGE,
              height: BADGE,
              borderRadius: BADGE,
              background: correctColor,
              // The glyph is cut out of the badge in the card's own paper, the one
              // colour guaranteed to read against `correct` in all six themes.
              color: theme.colors.surface,
            }}
          >
            <Check size={20} strokeWidth={2.6} />
          </span>
        </span>
      ) : null}
    </div>
  );

  if (mode !== "edit") return card(null);
  return (
    <Suspense fallback={card(null)}>
      <EditableLabel
        slideId={slideId}
        id={element.id}
        doc={element.doc}
        style={textTypeCss(r)}
        render={({ editor }) => card(editor)}
      />
    </Suspense>
  );
}
