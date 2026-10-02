import type { RichDoc, RichNode, Slide, SlideElement, Theme } from "@tj/domain/documents";
import { THEMES } from "./themes";

/*
 * Theme colours at render time. Generation writes the look's colours into the elements (a card's
 * surface fill, the accent bar, a kind tag's accent), so a lesson moved to another theme kept the
 * first theme's cards: cream cards under Night Lab's pale ink, an orange bar on Playground. Every colour that is one of any theme's tokens is read as that token and drawn
 * in the slide's own theme. A colour no theme uses (the teacher's own) is left as it is.
 */

type Token = keyof Theme["colors"];

/** Tokens in the order a shared hex is read as: a card's white is its surface, not the ground. */
const ORDER: Token[] = [
  "accent",
  "surface",
  "panel",
  "line",
  "onAccent",
  "accent2",
  "heading",
  "muted",
  "ink",
  "background",
  "correct",
  "incorrect",
];

const TOKEN_OF = (() => {
  const map = new Map<string, Token>();
  for (const token of ORDER) {
    for (const t of THEMES) {
      const hex = t.colors[token];
      if (typeof hex === "string" && !map.has(hex.toLowerCase())) map.set(hex.toLowerCase(), token);
    }
  }
  return map;
})();

/** `colour` in `theme`: the same token's value when it is a theme token, else as given. */
export function themedColour(colour: string | undefined, theme: Theme): string | undefined {
  if (!colour) return colour;
  const token = TOKEN_OF.get(colour.toLowerCase());
  if (!token) return colour;
  const own = theme.colors[token];
  if (typeof own === "string") return own;
  // A token this theme leaves unset (panel, heading) falls back as the renderer does.
  return token === "heading" ? theme.colors.ink : token === "panel" ? theme.colors.surface : colour;
}

function themedDoc(doc: RichDoc, theme: Theme): RichDoc {
  const walk = (nodes: RichNode[] | undefined): RichNode[] | undefined =>
    nodes?.map((n) => ({
      ...n,
      ...(n.marks
        ? {
            marks: n.marks.map((m) =>
              m.type === "textStyle" && typeof m.attrs?.color === "string"
                ? { ...m, attrs: { ...m.attrs, color: themedColour(m.attrs.color, theme) } }
                : m,
            ),
          }
        : {}),
      ...(n.content ? { content: walk(n.content) } : {}),
    })) as RichNode[] | undefined;
  return { ...doc, content: walk(doc.content) ?? [] } as RichDoc;
}

function themedElement(e: SlideElement, theme: Theme): SlideElement {
  const out = { ...e } as Record<string, unknown> & SlideElement;
  for (const key of ["fill", "stroke", "color"] as const) {
    const v = (e as Record<string, unknown>)[key];
    if (typeof v === "string") out[key] = themedColour(v, theme);
  }
  const style = (e as { style?: { color?: string } }).style;
  if (style?.color) out.style = { ...style, color: themedColour(style.color, theme) };
  const ts = (e as { textStyle?: { color?: string } }).textStyle;
  if (ts?.color) out.textStyle = { ...ts, color: themedColour(ts.color, theme) };
  const doc = (e as { doc?: RichDoc }).doc;
  if (doc) out.doc = themedDoc(doc, theme);
  return out;
}

/** The slide with every theme-token colour drawn in `theme`. */
export function withThemeColours(slide: Slide, theme: Theme): Slide {
  return { ...slide, elements: slide.elements.map((e) => themedElement(e, theme)) };
}
