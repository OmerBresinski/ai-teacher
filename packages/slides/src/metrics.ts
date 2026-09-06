import { SAFE } from "./grid";

/*
 * The numbers the text-fitting engine and the layout recipes share (ADR 0025 §9). Moved verbatim
 * from the editor's `layout/reflow.ts`, which re-exports them; the engine itself (measurement,
 * push-down, step-down, split) stays in the editor because it takes a `Measurer`.
 */

/**
 * Cross-browser slack (research/04 §4, DEFERRED wave 3). Spent as clearance below a
 * box that has to move, and as headroom in the overflow test — never stored in the
 * box's height, which `use-auto-height.ts` owns in edit mode. See the engine's header.
 */
export const SAFETY = 0.04;

/** The room a box needs, its cushion included. */
export const withSafety = (h: number) => Math.ceil(h * (1 + SAFETY));

/** Bottom edge of the safe area; content past it is an overflow. */
export const SAFE_BOTTOM = SAFE.y + SAFE.h;

/**
 * Chrome `OptionView` draws inside an option's box, and the leading it sets on the
 * card's text. Mirrored here because the renderer keeps them module-private; if they
 * move there, they move here.
 * (`slide/elements/OptionView.tsx`: PAD, CHIP, CHIP_GAP, TICK_LANE, and the
 * 1.35 leading research/04 §4 gives a card.)
 *
 * Exported so the recipes in `layouts.ts` can size a card from the same numbers the
 * engine measures it with, rather than from a number someone typed once.
 */
export const OPTION = {
  pad: 24,
  chip: 34,
  chipGap: 19,
  tickLane: 44,
  border: 1.5,
  line: 1.35,
} as const;
