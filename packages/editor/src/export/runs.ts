/**
 * Run-level walker over a Tiptap/ProseMirror doc (TeachDeck `lib/export/runs.ts`).
 *
 * `text/static.ts` flattens a doc to plain text; PPTX needs one level down: paragraphs, each a
 * list of runs carrying the marks PowerPoint understands. Pure and dependency-free so it runs in
 * Bun (tests, a future server export) as well as the browser.
 *
 * The mark names are the ones `text/extensions.ts` registers: bold, italic, underline, strike,
 * code, `link` with an `href` attribute, and `textStyle` with a `color` attribute.
 */
import type { RichDoc, RichNode } from "@tj/domain/documents";

export type RunAlign = "left" | "center" | "right" | "justify";
export type ListKind = "bullet" | "ordered";

export type Run = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  /** CSS colour exactly as authored, e.g. `#A94A18`. */
  color?: string;
  /** Link address exactly as authored. PowerPoint gets it as a run hyperlink. */
  href?: string;
};

export type RunParagraph = {
  runs: Run[];
  align?: RunAlign;
  /** Set when the paragraph is an item in a list. */
  list?: ListKind;
  /** List nesting depth, 0 for the outermost list and for plain paragraphs. */
  level: number;
  /** This paragraph followed a hard break, so it is a soft line, not a new block. */
  soft?: boolean;
};

const ALIGNS: RunAlign[] = ["left", "center", "right", "justify"];

function alignOf(node: RichNode): RunAlign | undefined {
  const value = node.attrs?.textAlign;
  return typeof value === "string" && (ALIGNS as string[]).includes(value)
    ? (value as RunAlign)
    : undefined;
}

function marksOf(node: RichNode): Omit<Run, "text"> {
  const out: Omit<Run, "text"> = {};
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case "bold":
      case "strong":
        out.bold = true;
        break;
      case "italic":
      case "em":
        out.italic = true;
        break;
      case "underline":
        out.underline = true;
        break;
      case "strike":
        out.strike = true;
        break;
      case "code":
        out.code = true;
        break;
      case "link": {
        const href = mark.attrs?.href;
        if (typeof href === "string" && href.trim()) out.href = href.trim();
        break;
      }
      case "textStyle": {
        const color = mark.attrs?.color;
        if (typeof color === "string" && color.trim()) out.color = color.trim();
        break;
      }
      default:
        break;
    }
  }
  return out;
}

const sameStyle = (a: Run, b: Omit<Run, "text">): boolean =>
  !!a.bold === !!b.bold &&
  !!a.italic === !!b.italic &&
  !!a.underline === !!b.underline &&
  !!a.strike === !!b.strike &&
  !!a.code === !!b.code &&
  a.color === b.color &&
  a.href === b.href;

/**
 * Flatten a doc to paragraphs of styled runs.
 *
 * - Adjacent runs with identical marks are merged, so PowerPoint gets one `<a:r>` per visual span
 *   rather than one per ProseMirror text node.
 * - `hardBreak` starts a new paragraph flagged `soft`, which maps to PowerPoint's shift+enter
 *   (`softBreakBefore`) rather than a new block.
 * - Empty paragraphs are kept: they are the teacher's deliberate blank line.
 */
export function docToRuns(doc: RichDoc | RichNode | undefined): RunParagraph[] {
  const out: RunParagraph[] = [];
  if (!doc) return out;

  /** Inline content of one block, splitting at hard breaks. */
  const collect = (
    node: RichNode,
    start: RunParagraph,
    align: RunAlign | undefined,
    list: ListKind | undefined,
    level: number,
  ): void => {
    let para = start;
    const push = (child: RichNode) => {
      if (child.type === "hardBreak") {
        para = { runs: [], level, soft: true };
        if (align) para.align = align;
        if (list) para.list = list;
        out.push(para);
        return;
      }
      if (typeof child.text === "string") {
        if (child.text.length === 0) return;
        const style = marksOf(child);
        const last = para.runs[para.runs.length - 1];
        if (last && sameStyle(last, style)) last.text += child.text;
        else para.runs.push({ text: child.text, ...style });
        return;
      }
      for (const inner of child.content ?? []) push(inner);
    };
    for (const child of node.content ?? []) push(child);
  };

  const walk = (
    node: RichNode,
    list: ListKind | undefined,
    level: number,
    align: RunAlign | undefined,
  ): void => {
    switch (node.type) {
      case "bulletList":
        for (const child of node.content ?? []) walk(child, "bullet", list ? level + 1 : 0, align);
        return;
      case "orderedList":
        for (const child of node.content ?? []) walk(child, "ordered", list ? level + 1 : 0, align);
        return;
      case "listItem":
      case "taskItem":
        for (const child of node.content ?? []) walk(child, list, level, align);
        return;
      case "paragraph":
      case "heading": {
        const para: RunParagraph = { runs: [], level };
        const own = alignOf(node) ?? align;
        if (own) para.align = own;
        if (list) para.list = list;
        out.push(para);
        collect(node, para, own, list, level);
        return;
      }
      default:
        for (const child of node.content ?? []) walk(child, list, level, alignOf(node) ?? align);
    }
  };

  walk(doc as RichNode, undefined, 0, undefined);
  return out;
}

/** The paragraphs joined back to plain text, for notes and answer lists. */
export function runsToText(paragraphs: RunParagraph[]): string {
  return paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join("\n");
}
