import type { RichDoc, Slide, SlideElement, TextElement, Theme } from "@tj/domain/documents";
import { richDocToPlainText } from "@tj/domain/documents";
import { uid } from "./factories";
import { SAFE, SPACE, snapY } from "./grid";
import { SAFE_BOTTOM } from "./metrics";
import { measureHeadless } from "./text-measure";
import { readingSize, resolveFontSize } from "./text-style";

/*
 * Quotations (UX ruling 157). Every straight quote a writer types is set curly, and a quotation
 * long enough to read as one (five words or more, or verse with a "/" line break) is set as a
 * quote block: a large accent open-quote, the words in italic at the body x1.2 with a 3-point
 * accent rule at their left, verse kept as lines, and an attribution line under it naming the
 * speaker and the act and scene when the text gives them ("Prospero, Act 1 Scene 2").
 */

/** Straight quotes set curly: an opening one after a space or bracket, a closing one otherwise. */
export function curlyQuotes(text: string): string {
  return text
    .replace(/(^|[\s([{—–])"/g, "$1“")
    .replace(/"/g, "”")
    .replace(/(^|[\s([{—–])'/g, "$1‘")
    .replace(/'/g, "’");
}

export type QuoteParts = {
  /** The quotation's words, verse lines split at " / ". */
  lines: string[];
  speaker?: string;
  /** "Act 1 Scene 2" when the text gives the act and scene. */
  where?: string;
  /** What the text asks or says once the quotation and its lead are taken out. */
  rest: string;
};

const SPEECH =
  /([A-Z][a-z]+)(?:\s+(?:tells|says|asks|warns|promises|commands|calls|orders|threatens|replies|answers|declares|cries|tells\s+[A-Z][a-z]+))(?:\s+[A-Z][a-z]+)?\s*,?\s*$/;

/** The quotation in a text set as a block, or undefined when it has none that long. */
export function quoteParts(raw: string): QuoteParts | undefined {
  const text = curlyQuotes(raw.trim());
  const m = /“([^”]+)”/.exec(text);
  if (!m) return undefined;
  const words = (m[1] ?? "").trim();
  const verse = words.includes(" / ");
  if (!verse && words.split(/\s+/).length < 5) return undefined;
  const before = text.slice(0, m.index).trim();
  let after = text.slice(m.index + m[0].length);
  let where: string | undefined;
  const ref = /^\s*\((\d+)\.(\d+)(?:\.\d+)?\)/.exec(after);
  if (ref) {
    where = `Act ${ref[1]} Scene ${ref[2]}`;
    after = after.slice(ref[0].length);
  } else {
    const named = /Act\s+(\d+),?\s+Scene\s+(\d+)/i.exec(text);
    if (named) where = `Act ${named[1]} Scene ${named[2]}`;
  }
  const said = SPEECH.exec(before);
  const speaker = said?.[1];
  const lead = said ? before.slice(0, said.index).trim() : before;
  const rest = [lead.replace(/[,:]\s*$/, ""), after.replace(/^[\s.,;:]+/, "")]
    .filter((s) => s.trim())
    .join(" ")
    .trim();
  return {
    lines: verse ? words.split(/\s+\/\s+/) : [words],
    ...(speaker ? { speaker } : {}),
    ...(where ? { where } : {}),
    rest,
  };
}

export const QUOTE_NAME = "Quote";
export const QUOTE_MARK_NAME = "Quote mark";
export const QUOTE_RULE_NAME = "Quote rule";
export const QUOTE_ATTRIBUTION_NAME = "Quote attribution";

const para = (text: string, italic = false) => ({
  type: "paragraph",
  content: [{ type: "text", text, ...(italic ? { marks: [{ type: "italic" }] } : {}) }],
});

/**
 * A question slide whose prompt quotes the text (open response, a single prompt) with the
 * quotation lifted into a quote block over the question. Any other slide comes back unchanged.
 */
export function withQuoteBlock(slide: Slide, t: Theme, ids: () => string = uid): Slide {
  if (slide.kind !== "open-response") return slide;
  const texts = slide.elements.filter((e): e is TextElement => e.type === "text");
  const stem = texts.find((e) => quoteParts(richDocToPlainText(e.doc)));
  if (!stem) return slide;
  const q = quoteParts(richDocToPlainText(stem.doc)) as QuoteParts;
  const measure = measureHeadless(t);
  const size = Math.round(readingSize(t) * 1.2);
  const qSize = resolveFontSize(t, "subtitle");
  const x = SAFE.x + SPACE[5];
  const w = SAFE.w - SPACE[5] * 2;
  const quoteDoc: RichDoc = { type: "doc", content: q.lines.map((l) => para(l, true)) };
  const h = (doc: RichDoc, preset: "body" | "small" | "subtitle", fs: number, width = w) =>
    Math.ceil(
      measure({
        doc,
        width,
        style: { preset, fontSize: fs },
        preset,
        fontSize: fs,
        inset: 0,
        chrome: 0,
      }),
    );
  const qh = h(quoteDoc, "body", size);
  const attribution = [q.speaker, q.where].filter(Boolean).join(", ");
  const aDoc = attribution ? ({ type: "doc", content: [para(attribution)] } as RichDoc) : undefined;
  const ah = aDoc ? h(aDoc, "small", resolveFontSize(t, "small")) : 0;
  const restDoc = q.rest ? ({ type: "doc", content: [para(q.rest)] } as RichDoc) : undefined;
  const rh = restDoc ? h(restDoc, "subtitle", qSize, SAFE.w) : 0;
  const total = qh + (aDoc ? SPACE[2] + ah : 0) + (restDoc ? SPACE[6] + rh : 0);
  let y = snapY(SAFE.y + Math.max(0, Math.floor((SAFE_BOTTOM - SAFE.y - total) / 3)));
  const els: SlideElement[] = [
    {
      id: ids(),
      type: "text",
      x: SAFE.x - 4,
      y: y - Math.round(size * 0.9),
      w: SPACE[5],
      h: Math.round(size * 2.2),
      doc: { type: "doc", content: [para("“")] },
      style: {
        preset: "title",
        fontSize: Math.round(size * 3),
        lineHeight: 1,
        color: t.colors.accent,
        autoHeight: false,
      },
      name: QUOTE_MARK_NAME,
    } as TextElement,
    {
      id: ids(),
      type: "shape",
      shape: "rect",
      x: x - SPACE[3],
      y,
      w: 3,
      h: qh,
      fill: t.colors.accent,
      name: QUOTE_RULE_NAME,
    } as SlideElement,
    {
      id: ids(),
      type: "text",
      x,
      y,
      w,
      h: qh,
      doc: quoteDoc,
      style: { preset: "body", fontSize: size, color: t.colors.ink, autoHeight: true },
      name: QUOTE_NAME,
    } as TextElement,
  ];
  y += qh;
  if (aDoc) {
    y += SPACE[2];
    els.push({
      id: ids(),
      type: "text",
      x,
      y,
      w,
      h: ah,
      doc: aDoc,
      style: { preset: "small", color: t.colors.muted, fontWeight: 600, autoHeight: true },
      name: QUOTE_ATTRIBUTION_NAME,
    } as TextElement);
    y += ah;
  }
  if (restDoc) {
    y += SPACE[6];
    els.push({
      ...stem,
      x: SAFE.x,
      y,
      w: SAFE.w,
      h: rh,
      doc: restDoc,
      style: {
        ...stem.style,
        preset: "subtitle",
        fontSize: qSize,
        align: "left",
        color: t.colors.ink,
      },
    });
  }
  // The stem's card goes with it: the block sits on the slide's ground.
  const card = (e: SlideElement) =>
    e.type === "shape" &&
    e.x <= stem.x &&
    e.y <= stem.y &&
    e.x + e.w >= stem.x + stem.w &&
    e.y + e.h >= stem.y + stem.h;
  const keep = slide.elements.filter((e) => e !== stem && !card(e));
  return { ...slide, elements: [...keep, ...els] };
}
