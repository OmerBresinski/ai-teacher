import type {
  RichDoc,
  RichNode,
  ShapeElement,
  Slide,
  SlideElement,
  TextElement,
} from "@tj/domain/documents";

/*
 * Generated text, tidied in code (spike/fmt, Greg's review 1 Oct 2026):
 *  - a list item carries no marker of its own: the list's kind (ordered or not) is structure, and
 *    the renderer draws the marker, so "• 1: Solve…" (a dot point the writer also numbered) cannot
 *    happen;
 *  - one slide uses one list kind;
 *  - no em dash anywhere, and no en dash used as a dash (a range such as 1990–1995 keeps its en
 *    dash).
 */

/** A dot point drawn as a shape (`@tj/slides` structure.ts `BULLET_NAME`). */
const BULLET = "Bullet";
/** A dot point's words (`ITEM_NAME`). */
const ITEM = "Point";
/** A numbered point's number, drawn where its dot would be. */
export const NUMBER_NAME = "Number";
const KIND_TAG = "Kind tag";

const MARK = "[•●▪◦‣∙*\\-–—]";
const NUMBERED = "(?:\\(?\\d{1,2}[.):]|\\(?[A-Za-z]\\))";
/**
 * A manual marker at the start of an item: a bullet glyph, a number or a letter ("1)", "1.",
 * "1:", "(1)", "a)"), or a glyph then a number ("• 1)"). A glyph needs a space after it, so
 * "-5 °C" keeps its sign; a number or letter needs a space or the end, so "1.5 kg" and "10:30"
 * keep theirs.
 */
const MARKER = new RegExp(
  `^\\s*(?:(${MARK})\\s*(?=${NUMBERED}(?:\\s|$))|(${MARK})\\s+)?(?:(${NUMBERED})(?:\\s+|$))?`,
);

/** An item's text without any manual marker, and whether the marker numbered it. */
export function stripListMarker(text: string): { text: string; numbered: boolean } {
  const m = MARKER.exec(text);
  if (!m || m[0].length === 0) return { text, numbered: false };
  return { text: text.slice(m[0].length), numbered: m[3] !== undefined };
}

/** Words that announce what follows: a dash after them reads as a colon. */
const ANNOUNCES =
  /\b(?:follows?|following|these|this|answer|rule|reasons?|results?|key|clues?|things|ways|steps|parts|two|three|four)$/i;

/**
 * A dash as punctuation, by its sentence: one of a pair (an aside) is a comma; a lone one is a
 * colon when it introduces a list or the words before it announce what follows; else a comma.
 */
function dashAs(before: string, after: string): string {
  const left = before.split(/[.!?]\s|\n/).pop() ?? "";
  const right = after.split(/[.!?](?:\s|$)|\n/)[0] ?? "";
  const dash = /\s—|—\s|\D—\D|\D\s–\s|\s–\s\D/;
  const paired = dash.test(left) || dash.test(right);
  if (paired || left.includes(":")) return ", ";
  const list = (right.match(/,/g)?.length ?? 0) >= 1 && /,\s.*\b(?:and|or)\b|,.*,/.test(right);
  return list || ANNOUNCES.test(left.trim()) ? ": " : ", ";
}

/**
 * No em dash, and no en dash used as a dash. A spaced em dash, or a spaced en dash between words,
 * becomes a comma or a colon by context (`dashAs`). An unspaced em dash becomes a spaced hyphen
 * between numbers (a range) and a comma otherwise. An en dash between numbers (1990–1995,
 * "60 – 10") and an unspaced one between words (Nazi–Soviet) is kept. A dash opening or closing
 * the text is dropped.
 */
export function cleanDashes(text: string): string {
  if (!/[—–]/.test(text)) return text;
  let s = text
    .replace(/^(\s*)[—–]\s+/gm, "$1")
    .replace(/\s+[—–]\s*$/gm, "")
    .replace(/(\d)\s*—\s*(?=\d)/g, "$1 - ");
  // Dashes used as punctuation, each decided on the text as written (so a pair stays a pair).
  const DASH = /\s+—\s*|\s*—\s+|(?<=\D)—(?=\D)|(?<=\D)\s+–\s+|\s+–\s+(?=\D)/g;
  let out = "";
  let from = 0;
  for (const m of s.matchAll(DASH)) {
    const at = m.index ?? 0;
    const before = s.slice(0, at);
    const after = s.slice(at + m[0].length);
    const sep =
      /[,:;(]$/.test(before.trimEnd()) || /^[,.;:!?)]/.test(after) ? " " : dashAs(before, after);
    out = `${out}${s.slice(from, at).replace(/\s+$/, "")}${sep}`;
    from = at + m[0].length;
    while (s.charAt(from) === " ") from += 1;
  }
  s = out + s.slice(from);
  return s.replace(/ {2,}/g, " ");
}

const isText = (e: SlideElement): e is TextElement => e.type === "text";

const docLeadText = (p: RichNode): string =>
  (p.content ?? []).map((n) => (n.type === "text" ? (n.text ?? "") : "")).join("");

/** A paragraph without its first `n` characters of text (a marker that may span text runs). */
function dropLead(p: RichNode, n: number): RichNode {
  let left = n;
  const content: RichNode[] = [];
  for (const node of p.content ?? []) {
    if (left > 0 && node.type === "text") {
      const t = node.text ?? "";
      if (t.length <= left) {
        left -= t.length;
        continue;
      }
      content.push({ ...node, text: t.slice(left) });
      left = 0;
      continue;
    }
    content.push(node);
  }
  return { ...p, content };
}

/** A paragraph's leading marker removed; `numbered` when it was a number or letter. */
function stripParagraph(p: RichNode): { node: RichNode; numbered: boolean; marked: boolean } {
  const lead = docLeadText(p);
  const { text, numbered } = stripListMarker(lead);
  const cut = lead.length - text.length;
  return cut > 0
    ? { node: dropLead(p, cut), numbered, marked: true }
    : { node: p, numbered: false, marked: false };
}

/** Every text run's dashes cleaned. */
function cleanNode(n: RichNode): RichNode {
  if (n.type === "text") return n.text ? { ...n, text: cleanDashes(n.text) } : n;
  return n.content ? { ...n, content: n.content.map(cleanNode) } : n;
}

type ListKind = "orderedList" | "bulletList";

/** A doc's lists set to `kind` (when given), each item's own marker removed. */
function tidyLists(n: RichNode, kind: ListKind | undefined): RichNode {
  if (n.type === "listItem" && n.content?.[0]?.type === "paragraph") {
    const [first, ...rest] = n.content;
    return {
      ...n,
      content: [stripParagraph(first as RichNode).node, ...rest].map((c) => tidyLists(c, kind)),
    };
  }
  const isList = n.type === "orderedList" || n.type === "bulletList";
  const type = isList && kind ? kind : n.type;
  const out: RichNode = { ...n, type };
  if (isList && type === "bulletList") delete out.attrs;
  return n.content ? { ...out, content: n.content.map((c) => tidyLists(c, kind)) } : out;
}

function listKinds(n: RichNode, out: ListKind[]): ListKind[] {
  if (n.type === "orderedList" || n.type === "bulletList") out.push(n.type);
  for (const c of n.content ?? []) listKinds(c, out);
  return out;
}

const plain = (doc: RichDoc): string => (doc.content ?? []).map((p) => docLeadText(p)).join(" ");

export type TidyOptions = {
  /** The list kind the layout chose (generation's practise slide is numbered); else inferred. */
  ordered?: boolean;
  /** The first number on this page, for a numbered list continued from an earlier page. */
  start?: number;
};

/**
 * One slide's generated text tidied: no manual list markers, one list kind, numbers drawn by the
 * slide (a dot point's shape becomes its number, "1)"), and no em dashes. Ordered when the layout
 * says so, else when the slide shows order: a PRACTICE tag, points the writer numbered, or a
 * numbered list.
 */
export function tidySlide(slide: Slide, options: TidyOptions = {}): Slide {
  const items = slide.elements.filter((e): e is TextElement => isText(e) && e.name === ITEM);
  const firstOf = (e: TextElement) => e.doc.content?.[0];
  const numberedItems =
    items.length >= 2 &&
    items.every((e) => {
      const p = firstOf(e);
      return p ? stripListMarker(docLeadText(p)).numbered : false;
    });
  const kinds = slide.elements.flatMap((e) => (isText(e) ? listKinds(e.doc as RichNode, []) : []));
  const practise = slide.elements.some(
    (e) => isText(e) && e.name === KIND_TAG && /^practi[cs]e$/i.test(plain(e.doc).trim()),
  );
  const ordered = options.ordered ?? (practise || numberedItems || kinds.includes("orderedList"));
  const kind: ListKind | undefined =
    kinds.length > 0 || items.length > 0 ? (ordered ? "orderedList" : "bulletList") : undefined;

  const bullets = slide.elements
    .filter((e): e is ShapeElement => e.type === "shape" && e.name === BULLET)
    .sort((a, b) => a.y - b.y);
  const points = [...items].sort((a, b) => a.y - b.y);
  const numberFor = new Map<SlideElement, TextElement>();
  if (ordered && bullets.length === points.length) {
    const start = options.start ?? 1;
    bullets.forEach((b, i) => {
      const p = points[i] as TextElement;
      const size = p.style.fontSize ?? 20;
      const lh = p.style.lineHeight ?? 1.4;
      const indent = Math.round(size * 1.3);
      numberFor.set(b, {
        id: b.id,
        type: "text",
        x: p.x - indent,
        y: p.y,
        w: indent,
        h: Math.round(size * lh),
        doc: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: `${start + i})` }] }],
        },
        style: {
          preset: "body",
          fontSize: size,
          lineHeight: lh,
          fontWeight: 700,
          autoHeight: false,
          ...(b.fill ? { color: b.fill } : {}),
        },
        name: NUMBER_NAME,
      });
    });
  }

  const elements = slide.elements.map((e): SlideElement => {
    const number = numberFor.get(e);
    if (number) return number;
    if (!isText(e)) return e;
    let doc = e.doc as RichNode;
    if (e.name === ITEM && doc.content?.[0]?.type === "paragraph") {
      const [first, ...rest] = doc.content;
      doc = { ...doc, content: [stripParagraph(first as RichNode).node, ...rest] };
    }
    doc = cleanNode(tidyLists(doc, kind));
    return { ...e, doc: doc as RichDoc };
  });
  return {
    ...slide,
    elements,
    ...(typeof slide.notes === "string" ? { notes: cleanDashes(slide.notes) } : {}),
  };
}

/** A whole deck tidied, a numbered list running on across a continued slide's pages. */
export function tidySlides(slides: readonly Slide[]): Slide[] {
  return slides.map((s) => tidySlide(s));
}

/**
 * Every generated string in a value (a worksheet, a lesson's other fields) with its dashes
 * cleaned; ids, sources and data URLs untouched.
 */
export function cleanDashesDeep<T>(value: T): T {
  const SKIP = new Set(["id", "src", "url", "href", "type", "themeId", "name"]);
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === "string") {
      if (key && SKIP.has(key)) return v;
      if (/^(?:data:|https?:)/.test(v)) return v;
      return cleanDashes(v);
    }
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    }
    return v;
  };
  return walk(value) as T;
}
