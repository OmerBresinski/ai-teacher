import type { ElementType, SlideElement } from "@tj/domain/documents";

/**
 * Transform-layer geometry (TeachDeck `components/editor/transform/constants.ts`). Every measured
 * value is binding — TeachDeck SPEC §7 and research/01 "Decisions we recommend". Sizes marked
 * "screen px" are divided by the canvas scale at render time so the chrome is the same physical
 * size at 50%, 100% and 200% zoom.
 */

/** Drawn handle side, screen px. */
export const HANDLE_SIZE = 8;
/** Handle corner radius, screen px. */
export const HANDLE_RADIUS = 2;
/** Handle hit area, screen px. Drawn size and hit size are different numbers. */
export const HANDLE_HIT = 20;
export const HANDLE_HIT_COARSE = 28;
/** Rotation hover zone diagonally outside each corner, screen px. */
export const ROTATE_ZONE = 20;
/** Selection frame stroke, screen px. */
export const FRAME_STROKE = 1.5;
/** Hover outline stroke, screen px, at 0.5 alpha. */
export const HOVER_STROKE = 1;
/** Guide stroke, screen px. */
export const GUIDE_STROKE = 1;
/** Padlock glyph on a locked element, screen px. */
export const LOCK_GLYPH = 12;

/** Minimum element size, slide points. */
export const MIN_SIZE = 16;
/** How far an element may hang off the stage, slide points. */
export const OVERHANG = 40;

/** Rotation snapping. */
export const ROTATE_SNAP_DEG = 15;
export const ROTATE_SNAP_THRESHOLD_DEG = 4;
export const ROTATE_FINE_DEG = 1;

/** Keyboard nudge, slide points. */
export const NUDGE = 1;
export const NUDGE_BIG = 10;

/** Screen px of pointer travel before a click becomes a drag. */
export const DRAG_START_PX = 3;

/**
 * Corner handles lock aspect ratio by default for these — a stretched photo is the commonest
 * amateur tell. Shift releases it. Text is the inverse: free by default, Shift locks.
 */
export const ASPECT_LOCKED_TYPES: ReadonlySet<ElementType> = new Set<ElementType>([
  "image",
  "icon",
  "shape",
  "embed",
  "timer",
]);

/**
 * Element types whose double-click opens the inline text editor. `shape` is conditional — see
 * {@link isTextEditable}.
 */
export const TEXT_EDITABLE_TYPES: ReadonlySet<ElementType> = new Set<ElementType>([
  "text",
  "gap-text",
  "option",
  "shape",
]);

/**
 * Whether double-clicking this element opens the inline text editor. Shapes are editable (the
 * renderer seeds an empty label on first edit) except hairline rules, which are decoration and
 * too thin to type into.
 */
export function isTextEditable(el: SlideElement): boolean {
  if (!TEXT_EDITABLE_TYPES.has(el.type)) return false;
  if (el.type === "shape") return el.w > 4 && el.h > 4;
  return true;
}

/**
 * Handle hit size in screen px. Flat {@link HANDLE_HIT} normally, but shrunk on an element small
 * enough that eight 20px boxes would overlap each other and swallow the edge handles (a 16pt
 * element at 25% zoom is 4 screen px across). Never smaller than the drawn handle, and the
 * *drawn* size never changes.
 */
export function handleHitSize(rect: { w: number; h: number }, scale: number, coarse = false) {
  const base = coarse ? HANDLE_HIT_COARSE : HANDLE_HIT;
  const shortest = Math.min(rect.w, rect.h) * (scale || 1);
  if (shortest >= base * 3) return base;
  return Math.max(HANDLE_SIZE, Math.min(base, shortest / 3));
}

export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const HANDLES: HandleId[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Unit direction of each handle from the box centre. */
export const HANDLE_DIR: Record<HandleId, { x: -1 | 0 | 1; y: -1 | 0 | 1 }> = {
  nw: { x: -1, y: -1 },
  n: { x: 0, y: -1 },
  ne: { x: 1, y: -1 },
  e: { x: 1, y: 0 },
  se: { x: 1, y: 1 },
  s: { x: 0, y: 1 },
  sw: { x: -1, y: 1 },
  w: { x: -1, y: 0 },
};

export const CORNERS: HandleId[] = ["nw", "ne", "se", "sw"];

/**
 * Colour tokens. The selection frame and handles paint from `@tj/ui`'s `--primary` (the system
 * accent, as TeachDeck's `--accent`); guides keep the research/04 magenta, which no token owns.
 */
export const TOKENS = {
  frame: "var(--primary)",
  handleFill: "var(--card)",
  guide: "#E0326B",
  marqueeFill: "rgb(210 100 75 / 0.08)",
} as const;

/** No standard `rotate` cursor exists; this is a 16px glyph with a grab fallback. */
export const ROTATE_CURSOR = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><g fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6.5A6 6 0 1 0 16 10"/><path d="M15.5 2.5v4h-4"/></g><g fill="none" stroke="#1B1A17" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6.5A6 6 0 1 0 16 10"/><path d="M15.5 2.5v4h-4"/></g></svg>',
)}") 10 10, grab`;

/** Resize cursors by angle bucket; index = round(angle / 45) mod 4. */
const RESIZE_CURSORS = ["ns-resize", "nesw-resize", "ew-resize", "nwse-resize"] as const;

/** Cursor for a handle, accounting for the element's rotation. */
export function resizeCursor(handle: HandleId, rotation = 0): string {
  const d = HANDLE_DIR[handle];
  const deg = (Math.atan2(d.y, d.x) * 180) / Math.PI + rotation + 90;
  const idx = ((Math.round(deg / 45) % 4) + 4) % 4;
  return RESIZE_CURSORS[idx] ?? "ns-resize";
}
