/**
 * The hinge's reveal (TEACH-256 part b, v13 gold), loaded on demand by `SlideView`'s
 * `ChoiceMarks` so the surface role table stays out of the present, view and print chunks.
 */
import type { Slide, SlideElement, Theme } from "@tj/domain/documents";
import { surfaceStyle } from "@tj/slides/surfaces";
import { choiceText, HINGE_KEY } from "./choice";

/** The hinge's element names (`@tj/slides` templates/hinge.ts `HINGE_NAMES`). */
const HINGE_ICON = "Option icon";
const HINGE_STAGE = "surface:field-b";

export type HingeMark = {
  wash: string;
  ring: string;
  keyFill: string;
  keyInk: string;
  radius: number;
  key: {
    x: number;
    y: number;
    w: number;
    h: number;
    radius: number;
    letter: string;
    fontSize: number;
  } | null;
  tick: { d: number; right: number; top: number };
};

/**
 * How the reveal marks a hinge card (TEACH-256 part b, v13 gold): ring, tick and the right card's
 * key in the theme's correct colour (`verdict-right` and `key:right` are built from it), a wrong card faded to about a third into
 * the sand stage. Null for any other choice card, which keeps the generic marks.
 */
/** The hinge reveal's theme roles: `verdict-right` (ring, tick) and `key:right` (the key). */
export type HingeRoles = { ring: string; keyFill: string; keyInk: string };

export function hingeMarkOf(
  slide: Slide,
  theme: Theme,
  id: string,
  given?: HingeRoles,
): HingeMark | null {
  const card = slide.elements.find((e) => e.id === id);
  if (!card || card.type === "option") return null;
  const inside = (e: SlideElement) =>
    e.x >= card.x && e.y >= card.y && e.x + e.w <= card.x + card.w && e.y + e.h <= card.y + card.h;
  const keyEl = slide.elements.find((e) => e.name === HINGE_KEY && inside(e));
  if (!keyEl) return null;
  const k = surfaceStyle(theme, "key", "right");
  const roles = given ?? {
    ring: surfaceStyle(theme, "verdict-right").fill,
    keyFill: k.fill,
    keyInk: k.ink ?? theme.colors.onAccent,
  };
  const stage = slide.elements.find((e) => e.name === HINGE_STAGE);
  const ground =
    stage && "fill" in stage && typeof stage.fill === "string"
      ? stage.fill
      : theme.colors.background;
  const tiles = slide.elements.some((e) => e.name === HINGE_ICON && inside(e));
  const d = Math.round(keyEl.w * 0.78);
  const radius = keyEl.type === "shape" && keyEl.radius ? keyEl.radius : Math.round(keyEl.w * 0.24);
  const fontSize = keyEl.type === "shape" ? Number(keyEl.textStyle?.fontSize ?? 20) : 20;
  return {
    // 66% of the stage over the card: the card reads at about a third (the gold's 0.34).
    ...roles,
    wash: `${ground.slice(0, 7)}A8`,
    radius:
      "radius" in card && typeof card.radius === "number"
        ? card.radius
        : Math.min(theme.radius, 16),
    key: {
      x: keyEl.x,
      y: keyEl.y,
      w: keyEl.w,
      h: keyEl.h,
      radius,
      letter: choiceText(slide, keyEl.id),
      fontSize,
    },
    tick: tiles ? { d, right: 16, top: 16 } : { d, right: 19, top: Math.round((card.h - d) / 2) },
  };
}

type Placed = Map<string, { x: number; y: number; w: number; h: number }>;

/** The editor's hinge reveal: wash, `verdict-right` ring and tick, the key in `key:right`. */
export default function HingeMarks({
  slide,
  theme,
  marks,
  placed,
}: {
  slide: Slide;
  theme: Theme;
  marks: { id: string; state: "dim" | "right" }[];
  placed: Placed;
}) {
  return (
    <>
      {marks.map(({ id, state }) => {
        const r = placed.get(id);
        const m = hingeMarkOf(slide, theme, id);
        if (!r || !m) return null;
        const right = state === "right";
        const k = right ? m.key : null;
        const flex = {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          lineHeight: 1,
        } as const;
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
              borderRadius: m.radius,
              background: right ? undefined : m.wash,
              boxShadow: right ? `0 0 0 3px ${m.ring}` : undefined,
            }}
          >
            {k ? (
              <span
                style={{
                  ...flex,
                  position: "absolute",
                  left: k.x - r.x,
                  top: k.y - r.y,
                  width: k.w,
                  height: k.h,
                  borderRadius: k.radius,
                  background: m.keyFill,
                  color: m.keyInk,
                  fontSize: k.fontSize,
                }}
              >
                {k.letter}
              </span>
            ) : null}
            {right ? (
              <span
                role="img"
                aria-label="Correct answer"
                style={{
                  ...flex,
                  position: "absolute",
                  right: m.tick.right,
                  top: m.tick.top,
                  width: m.tick.d,
                  height: m.tick.d,
                  borderRadius: m.tick.d,
                  background: m.ring,
                  color: m.keyInk,
                  fontSize: Math.round(m.tick.d * 0.6),
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
