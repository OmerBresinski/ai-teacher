/**
 * The hinge's reveal (TEACH-256 part b, v13 gold), loaded on demand by `SlideView`'s
 * `ChoiceMarks` so the surface role table stays out of the present, view and print chunks.
 */
import type { Slide, SlideElement, TextElement, Theme } from "@tj/domain/documents";
import { dimGround, dimInk, surfaceStyle } from "@tj/slides/surfaces";
import { choiceText, HINGE_KEY } from "./choice";
import { ElementBody } from "./ElementBody";

/** The hinge's element names (`@tj/slides` templates/hinge.ts `HINGE_NAMES`). */
const HINGE_ICON = "Option icon";
const HINGE_BAR = "Fraction bar";
/** A wrong card's picture steps back with its words; pictures carry no text contrast. */
const DIM_PICTURE = 0.4;

export type HingeMark = {
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
 * key in the theme's correct colour (`verdict-right` and `key:right` are built from it). A wrong
 * card is redrawn by `hingeDimParts`. Null for any other choice card, which keeps the generic marks.
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
  const tiles = slide.elements.some((e) => e.name === HINGE_ICON && inside(e));
  const d = Math.round(keyEl.w * 0.78);
  const radius = keyEl.type === "shape" && keyEl.radius ? keyEl.radius : Math.round(keyEl.w * 0.24);
  const fontSize = keyEl.type === "shape" ? Number(keyEl.textStyle?.fontSize ?? 20) : 20;
  return {
    ...roles,
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

/** Every colour a text's runs set, turned to `ink`, so no run keeps the card's full ink. */
function inkRuns(doc: TextElement["doc"], ink: string): TextElement["doc"] {
  const walk = (n: unknown): unknown => {
    if (!n || typeof n !== "object") return n;
    const node = n as { content?: unknown[]; marks?: { type: string; attrs?: object }[] };
    return {
      ...node,
      ...(node.content ? { content: node.content.map(walk) } : {}),
      ...(node.marks
        ? {
            marks: node.marks.map((m) =>
              m.attrs && "color" in m.attrs ? { ...m, attrs: { ...m.attrs, color: ink } } : m,
            ),
          }
        : {}),
    };
  };
  return walk(doc) as TextElement["doc"];
}

/**
 * A wrong hinge card after the reveal (ruling 258, TEACH-256 part d): the card redrawn on the
 * theme's quieter ground (`dimGround`), so it still reads as not the answer beside the right card,
 * and its words, letter key, fraction bars and icon in the dim tone (`dimInk`, at least 4.5:1 on
 * that ground); its picture stepped back. Never an opacity wash over the words. The key's letter
 * takes the same ground, so it reads on the dim key as the words read on the card. The editor
 * draws these over the card; the PowerPoint build slide draws them too.
 */
export function hingeDimParts(slide: Slide, theme: Theme, id: string): SlideElement[] {
  const card = slide.elements.find((e) => e.id === id);
  if (!card || card.type === "option") return [];
  const dim = dimInk(theme);
  const ground = dimGround(theme);
  const inside = (e: SlideElement) =>
    e.x >= card.x && e.y >= card.y && e.x + e.w <= card.x + card.w && e.y + e.h <= card.y + card.h;
  const dimmed = (e: SlideElement): SlideElement => {
    if (e.type === "text")
      return { ...e, style: { ...e.style, color: dim }, doc: inkRuns(e.doc, dim) };
    if (e.type === "shape" && e.name === HINGE_KEY)
      return { ...e, fill: dim, textStyle: { ...e.textStyle, color: ground } } as SlideElement;
    if (e.type === "shape" && e.name === HINGE_BAR) return { ...e, fill: dim };
    if (e.type === "icon") return { ...e, color: dim };
    if (e.type === "image") return { ...e, opacity: DIM_PICTURE };
    return e;
  };
  const quiet = "fill" in card ? ({ ...card, fill: ground } as SlideElement) : card;
  return [quiet, ...slide.elements.filter((e) => e.id !== id && inside(e)).map(dimmed)];
}

type Placed = Map<string, { x: number; y: number; w: number; h: number }>;

/**
 * The editor's hinge reveal: each wrong card redrawn in the dim tone, the right one ringed and
 * ticked in `verdict-right`, its key in `key:right`.
 */
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
        if (state === "dim")
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
              }}
            >
              {hingeDimParts(slide, theme, id).map((el) => (
                <div
                  key={el.id}
                  data-dim-part={el.id}
                  style={{
                    position: "absolute",
                    left: el.x - r.x,
                    top: el.y - r.y,
                    width: el.w,
                    height: el.h,
                    opacity: el.opacity ?? 1,
                  }}
                >
                  <ElementBody
                    element={el}
                    theme={theme}
                    mode="capture"
                    slideId={slide.id}
                    hidden={false}
                    ghost={false}
                    revealAnswer={false}
                  />
                </div>
              ))}
            </div>
          );
        const k = m.key;
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
              boxShadow: `0 0 0 3px ${m.ring}`,
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
          </div>
        );
      })}
    </>
  );
}
