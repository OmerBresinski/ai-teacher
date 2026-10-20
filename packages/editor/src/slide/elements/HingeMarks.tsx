/**
 * The hinge's reveal (TEACH-256 part b, v13 gold), loaded on demand by `SlideView`'s
 * `ChoiceMarks` so the surface role table stays out of the present, view and print chunks.
 */
import {
  mapRunColours,
  type ShapeElement,
  type Slide,
  type SlideElement,
  type Theme,
} from "@tj/domain/documents";
import { badgeGlyph, contrastRatio, mix, tickPolygon } from "@tj/slides";
import { markHexagonPoints, notchPoints, octagonPoints } from "@tj/slides/marks";
import {
  dimGround,
  dimInk,
  isClear,
  splitAlpha,
  surfaceStyle,
  surfacesOf,
} from "@tj/slides/surfaces";
import { choiceText, HINGE_KEY } from "./choice";
import { ElementBody } from "./ElementBody";
import { badgeGlyphType, badgeGlyphVars } from "./kit";

/** The hinge's element names (`@tj/slides` templates/hinge.ts `HINGE_NAMES`). */
const HINGE_ICON = "Option icon";
const HINGE_BAR = "Fraction bar";

export type HingeMark = {
  ring: string;
  /** The ring's width inside the card (Geometric), or 0 for the 3pt ring outside it. */
  ringInset: number;
  keyFill: string;
  keyInk: string;
  radius: number;
  key: {
    x: number;
    y: number;
    w: number;
    h: number;
    radius: number;
    /** A key drawn as a polygon (Geometric's notch, a hexagon): the overlay is clipped to it. */
    clip?: string;
    /** The key element's own shape kind, so the PowerPoint reveal draws the same outline. */
    shape: KeyShape;
    letter: string;
    fontSize: number;
  } | null;
  tick: { d: number; right: number; top: number };
};

const KEY_SHAPES = ["rounded", "notch", "hexagon", "octagon", "ellipse", "rect"] as const;
type KeyShape = (typeof KEY_SHAPES)[number];
function keyShape(e: SlideElement): KeyShape {
  const k = e.type === "shape" ? e.shape : "rounded";
  return (KEY_SHAPES as readonly string[]).includes(k) ? (k as KeyShape) : "rounded";
}

/** A CSS clip for a key drawn as a polygon, in the same box fractions as `ShapeView`. */
function keyClip(shape: string, w: number, h: number, radius?: number): string | undefined {
  const pts =
    shape === "notch"
      ? notchPoints(w, h, radius ?? Math.round(w * 0.22))
      : shape === "hexagon"
        ? markHexagonPoints()
        : shape === "octagon"
          ? octagonPoints(w, h)
          : null;
  return pts
    ? `polygon(${pts.map((p) => `${(p.x * 100).toFixed(2)}% ${(p.y * 100).toFixed(2)}%`).join(", ")})`
    : undefined;
}

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
  const clip =
    keyEl.type === "shape" ? keyClip(keyEl.shape, keyEl.w, keyEl.h, keyEl.radius) : undefined;
  return {
    ...roles,
    ringInset: surfacesOf(theme).marks.rightRingInset,
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
      ...(clip ? { clip } : {}),
      shape: keyShape(keyEl),
      letter: choiceText(slide, keyEl.id),
      fontSize,
    },
    tick: tiles ? { d, right: 16, top: 16 } : { d, right: 19, top: Math.round((card.h - d) / 2) },
  };
}

/** A hinge card the reveal can redraw: a shape with an opaque fill, so its redraw hides the original. */
type HingeCard = ShapeElement & { fill: string };

const isHingeCard = (e: SlideElement): e is HingeCard =>
  e.type === "shape" &&
  typeof e.fill === "string" &&
  !isClear(e.fill) &&
  splitAlpha(e.fill).opacity === undefined;

/** An opaque `#rrggbb` colour, or undefined for a clear, see-through or non-hex one. */
const solid = (c: unknown): string | undefined =>
  typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) && !isClear(c) ? c : undefined;

/**
 * Any CSS colour a part may carry (`#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`) as an opaque
 * `#RRGGBB` and its alpha; undefined for anything else (a name, a gradient, `transparent`).
 */
export function parseColour(c: unknown): { hex: string; alpha: number } | undefined {
  if (typeof c !== "string" || isClear(c)) return undefined;
  const t = c.trim();
  let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(t);
  if (m) return { hex: `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toUpperCase(), alpha: 1 };
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(t)) {
    const { color, opacity } = splitAlpha(t);
    return { hex: color.toUpperCase(), alpha: opacity ?? 1 };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(t);
  if (!m) return undefined;
  const to2 = (v: string) =>
    Math.max(0, Math.min(255, Math.round(Number(v))))
      .toString(16)
      .padStart(2, "0");
  const a = m[4] == null ? 1 : m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
  return {
    hex: `#${to2(m[1] as string)}${to2(m[2] as string)}${to2(m[3] as string)}`.toUpperCase(),
    alpha: a,
  };
}

/** A colour faded toward `behind` by the gold's `.34`, its own alpha kept (`#RRGGBBAA`). */
function fadeColour(c: unknown, behind: string): string | undefined {
  const p = parseColour(c);
  if (!p) return undefined;
  const hex = mix(p.hex, behind, HINGE_FADE);
  return p.alpha >= 1
    ? hex
    : `${hex}${Math.round(p.alpha * 255)
        .toString(16)
        .padStart(2, "0")
        .toUpperCase()}`;
}

/** The first colour in a fill that is not one plain colour (a CSS gradient's first stop). */
function firstColour(c: unknown): string | undefined {
  if (typeof c !== "string") return undefined;
  const hit = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/i.exec(c);
  const p = hit ? parseColour(hit[0]) : undefined;
  return p?.hex;
}

/**
 * How much of a wrong card still shows after the reveal: the gold's `.hg.shown .opt:not(.ok)
 * { opacity: .34 }` (northstars-v13 hinge.html), worked as colours over the stage behind the card
 * (TEACH-215 part i), so the card, its line, its key and its picture step back as in the gold.
 */
export const HINGE_FADE = 0.34;

/**
 * `tone` held at 4.5:1 on `ground` (ruling 258): stepped toward `ink` until it reads, then to
 * black or white. The gold's faded words fall under 4.5:1, so the words alone keep this floor.
 */
function readable(tone: string, ground: string, ink: string): string {
  for (let k = 0; k <= 1.0001; k += 0.05) {
    const c = mix(ink, tone, k);
    if (contrastRatio(c, ground) >= 4.5) return c;
  }
  return contrastRatio("#000000", ground) >= contrastRatio("#FFFFFF", ground)
    ? "#000000"
    : "#FFFFFF";
}

/**
 * The faded colours a wrong card is redrawn in: `ground` its fill, `behind` the stage it fades
 * into, `words` its words' tone (4.5:1 on `ground`), `ink` the card's full ink.
 */
export type HingeFade = { ground: string; behind: string; words: string; ink: string };
type Fade = HingeFade;

/** A wrong option's part, faded: words in the dim tone, key, bars, line and picture toward the stage. */
function dimmedPart(e: SlideElement, f: Fade): SlideElement[] {
  const fade = (c: unknown) => fadeColour(c, f.behind);
  switch (e.type) {
    case "text":
      return [
        { ...e, style: { ...e.style, color: f.words }, doc: mapRunColours(e.doc, () => f.words) },
      ];
    case "shape": {
      if (e.name === HINGE_KEY) {
        // The gold's key at .34: its own colour (a letter's tone, the ink or the accent) gone pale
        // on the faded card; its letter in the dim tone, held at 4.5:1 on that pale key.
        const fill = solid(e.fill) ? fade(e.fill) : isClear(e.fill as string) ? undefined : f.words;
        const stroke = fade(e.stroke);
        const letter = readable(f.words, fill ?? f.ground, f.ink);
        return [
          {
            ...e,
            ...(fill ? { fill } : {}),
            ...(stroke ? { stroke } : {}),
            ...(e.shadow
              ? { shadow: { ...e.shadow, color: fade(e.shadow.color) ?? f.behind } }
              : {}),
            textStyle: { ...e.textStyle, color: letter },
            ...(e.doc ? { doc: mapRunColours(e.doc, () => letter) } : {}),
          },
        ];
      }
      if (e.name === HINGE_BAR) return [{ ...e, fill: f.words }];
      // Any other shape on the card (one that overhangs its edge too) fades with it.
      const fill = fade(e.fill);
      const stroke = fade(e.stroke);
      return [{ ...e, ...(fill ? { fill } : {}), ...(stroke ? { stroke } : {}) }];
    }
    case "icon":
      return [{ ...e, color: f.words }];
    case "image": {
      const opacity = (e.opacity ?? 1) * HINGE_FADE;
      // A picture fades into the stage, as the gold's whole card does: a stage-coloured plate under
      // it, so none of the card shows through. A library icon (transparent around its drawing)
      // keeps the faded card around it, so it takes no plate.
      if (e.name === HINGE_ICON) return [{ ...e, opacity }];
      const plate: ShapeElement = {
        id: `${e.id}-stage`,
        type: "shape",
        shape: "rect",
        x: e.x,
        y: e.y,
        w: e.w,
        h: e.h,
        ...(e.rotation ? { rotation: e.rotation } : {}),
        fill: f.behind,
      };
      return [plate, { ...e, opacity }];
    }
    default:
      return [e];
  }
}

/**
 * The stage behind `card`: the hinge's sand field when it holds the card (a gradient field by its
 * first stop), else the slide's own colour, else the theme ground (a picture background has no one
 * colour, so the card fades toward the ground the theme lays under it).
 */
function behindOf(slide: Slide, theme: Theme, card: SlideElement): string {
  const stage = slide.elements.find(
    (e) =>
      e.name === "surface:field-b" &&
      e.x <= card.x &&
      e.y <= card.y &&
      e.x + e.w >= card.x + card.w &&
      e.y + e.h >= card.y + card.h,
  );
  const fill = stage && "fill" in stage ? stage.fill : undefined;
  const bg = slide.background;
  return (
    parseColour(fill)?.hex ??
    firstColour(fill) ??
    (bg?.image ? undefined : (parseColour(bg?.color)?.hex ?? firstColour(bg?.color))) ??
    dimGround(theme)
  );
}

function fadeOf(slide: Slide, theme: Theme, card: SlideElement): HingeFade {
  const behind = behindOf(slide, theme, card);
  const ground = isHingeCard(card) ? mix(card.fill, behind, HINGE_FADE) : dimGround(theme);
  const ink = surfaceStyle(theme, "card").ink ?? theme.colors.ink;
  return { ground, behind, words: readable(dimInk(theme), ground, ink), ink };
}

/** The colours the reveal fades the wrong card `id` to, or null when it is not a hinge card. */
export function hingeFade(slide: Slide, theme: Theme, id: string): HingeFade | null {
  const card = slide.elements.find((e) => e.id === id);
  return card && card.type !== "option" ? fadeOf(slide, theme, card) : null;
}

/**
 * A wrong hinge card after the reveal (ruling 258, TEACH-256 part d; the gold's fade, TEACH-215
 * part i): the card redrawn as the gold's `.34` fade over the stage behind it (its fill and line
 * mixed into the stage), its letter key gone pale in its own colour, its picture stepped back; its
 * words in the theme's dim tone, held at 4.5:1 or better on that faded card (ruling 258: never an
 * opacity wash over the words). The editor draws these over the card; the PowerPoint build slide
 * draws them too.
 *
 * The redraw always lays an opaque card first, so the original's full-ink words never show
 * through. A generated hinge card is a shape with an opaque fill (tested); a card a teacher made
 * see-through, or one that is not a shape, gets the theme's `dimGround` card under its dim words,
 * so the reveal keeps 4.5:1 and never throws in the middle of a render (a dev build warns).
 */
export function hingeDimParts(slide: Slide, theme: Theme, id: string): SlideElement[] {
  const card = slide.elements.find((e) => e.id === id);
  if (!card || card.type === "option") return [];
  if (!isHingeCard(card) && process.env.NODE_ENV !== "production")
    console.warn(`hinge card ${id} has no opaque fill: its reveal draws it on the theme ground`);
  const f = fadeOf(slide, theme, card);
  const { ground, behind } = f;
  // A part of the card: its centre inside the card and no larger than it, so a part that overhangs
  // the edge (a tilted sticky key, a tick) fades with its card, and the stage behind does not.
  const part = (e: SlideElement) => {
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    return (
      e.id !== id &&
      cx >= card.x &&
      cx <= card.x + card.w &&
      cy >= card.y &&
      cy <= card.y + card.h &&
      e.w * e.h <= card.w * card.h
    );
  };
  const line = card.type === "shape" ? fadeColour(card.stroke, behind) : undefined;
  const quiet: HingeCard =
    card.type === "shape"
      ? {
          ...card,
          fill: ground,
          ...(line ? { stroke: line } : {}),
          ...(card.shadow
            ? {
                shadow: {
                  ...card.shadow,
                  color: fadeColour(card.shadow.color, behind) ?? behind,
                },
              }
            : {}),
        }
      : {
          id: card.id,
          type: "shape",
          shape: "rounded",
          x: card.x,
          y: card.y,
          w: card.w,
          h: card.h,
          rotation: card.rotation,
          radius: Math.min(theme.radius, 16),
          fill: ground,
        };
  return [quiet, ...slide.elements.filter(part).flatMap((e) => dimmedPart(e, f))];
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
              // A redrawn copy of words the slide already holds: assistive tech reads them once.
              aria-hidden
              style={{
                userSelect: "none",
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
                    // As the slide and the PowerPoint path draw a turned part.
                    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
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
              boxShadow:
                m.ringInset > 0 ? `inset 0 0 0 ${m.ringInset}px ${m.ring}` : `0 0 0 3px ${m.ring}`,
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
                  borderRadius: k.clip ? 0 : k.radius,
                  clipPath: k.clip,
                  background: m.keyFill,
                  color: m.keyInk,
                  fontSize: k.fontSize,
                  // The key's letter is in the heading face, as on the slide.
                  fontFamily: theme.fonts.title,
                }}
              >
                <KeyLetter letter={k.letter} font={theme.fonts.title} size={k.fontSize} />
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
              }}
            >
              {/* A drawn tick centred on its disc (`tickPolygon`); a font's ✓ is not. */}
              <svg
                width={m.tick.d * 0.6}
                height={m.tick.d * 0.6}
                viewBox="0 0 24 24"
                aria-hidden
                focusable="false"
              >
                <polygon points={TICK_POINTS} fill="currentColor" />
              </svg>
            </span>
          </div>
        );
      })}
    </>
  );
}

const TICK_POINTS = tickPolygon(3.2)
  .map((p) => p.join(","))
  .join(" ");

/** The key's letter, centred on its cap height like every badge glyph (`badgeGlyph`). */
function KeyLetter({ letter, font, size }: { letter: string; font: string; size: number }) {
  const g = badgeGlyph(letter, font, size);
  return g ? (
    <span className="tj-badge-glyph" style={{ ...badgeGlyphType({}, size), ...badgeGlyphVars(g) }}>
      {letter}
    </span>
  ) : (
    letter
  );
}
