import type {
  Id,
  Lesson,
  RichDoc,
  Slide,
  SlideElement,
  SlideKind,
  TextElement,
  TextPreset,
} from "@tj/domain/documents";
import { nanoid } from "nanoid";
import { layoutSlide } from "./layouts";
import { FIT_VERSION } from "./themes";

export const uid = (): Id => nanoid(10);

export function now(): string {
  return new Date().toISOString();
}

/** Plain string → single-paragraph rich doc. */
export function docFromText(text: string): RichDoc {
  return {
    type: "doc",
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : undefined,
    })),
  };
}

/** A chunk's label: up to four words before a colon that ends it (not a ratio like 2:3). */
const CHUNK_LABEL = /^([^:\n.!?]{1,40}?):\s+(\S.*)$/;

/**
 * Text → rich doc, one paragraph a line, as `docFromText`; when there are two or more lines and
 * every one is a labelled chunk ("Gas: the particles…"), each label is set bold.
 */
export function docFromChunks(text: string): RichDoc {
  const lines = text.split("\n");
  const parts = lines.map((l) => CHUNK_LABEL.exec(l.trim()));
  const chunked =
    lines.length >= 2 &&
    parts.every((m) => m !== null && (m[1] ?? "").trim().split(/\s+/).length <= 4);
  if (!chunked) return docFromText(text);
  return {
    type: "doc",
    content: parts.map((m) => ({
      type: "paragraph",
      content: [
        { type: "text", text: `${(m?.[1] ?? "").trim()}:`, marks: [{ type: "bold" }] },
        { type: "text", text: ` ${m?.[2] ?? ""}` },
      ],
    })),
  };
}

/** A body written as labelled chunks: two or more paragraphs, each opening on a bold label. */
export function isChunked(doc: RichDoc): boolean {
  const nodes = doc.content ?? [];
  return (
    nodes.length >= 2 &&
    nodes.every(
      (n) => n.type === "paragraph" && !!n.content?.[0]?.marks?.some((m) => m.type === "bold"),
    )
  );
}

/** Bulleted list rich doc. */
export function docFromBullets(items: string[]): RichDoc {
  return {
    type: "doc",
    content: [
      {
        type: "bulletList",
        content: items.map((t) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
        })),
      },
    ],
  };
}

export function newText(
  preset: TextPreset,
  text: string | RichDoc,
  rect: { x: number; y: number; w: number; h: number },
  extra: Partial<TextElement> = {},
): TextElement {
  return {
    id: uid(),
    type: "text",
    ...rect,
    doc: typeof text === "string" ? docFromText(text) : text,
    style: { preset, autoHeight: true },
    ...extra,
  };
}

export function newLesson(title = "Untitled lesson", themeId = "chalk"): Lesson {
  const ts = now();
  return {
    version: 1,
    id: uid(),
    title,
    themeId,
    slides: [newSlide("title", themeId)],
    createdAt: ts,
    updatedAt: ts,
    // Laid out by the recipes against today's floors, so it is already fitted.
    fitVersion: FIT_VERSION,
  };
}

/** A slide of the given kind with its default elements laid out. */
export function newSlide(kind: SlideKind, themeId: string): Slide {
  const { elements, question } = layoutSlide(kind, themeId);
  const slide: Slide = { id: uid(), kind, elements };
  if (question) slide.question = question;
  return slide;
}

/** Deep copy with fresh ids (including group children and question references). */
export function cloneElement<T extends SlideElement>(el: T): T {
  const copy = structuredClone(el) as T;
  copy.id = uid();
  if (copy.type === "group") copy.children = copy.children.map(cloneElement);
  return copy;
}

export function cloneSlide(slide: Slide): Slide {
  const idMap = new Map<Id, Id>();
  const cloneWithMap = (el: SlideElement): SlideElement => {
    const copy = structuredClone(el);
    const fresh = uid();
    idMap.set(el.id, fresh);
    copy.id = fresh;
    if (copy.type === "group") copy.children = copy.children.map(cloneWithMap);
    return copy;
  };
  const elements = slide.elements.map(cloneWithMap);
  const copy: Slide = { ...structuredClone(slide), id: uid(), elements };
  // Re-point question references to the new element ids.
  if (copy.question) {
    const m = (id: Id) => idMap.get(id) ?? id;
    const q = copy.question;
    if (q.type === "multiple-choice") q.options = q.options.map((o) => ({ ...o, id: m(o.id) }));
    if (q.type === "matching")
      q.pairs = q.pairs.map((p) => ({
        ...p,
        leftElementId: m(p.leftElementId),
        rightElementId: m(p.rightElementId),
      }));
    if (q.type === "image-match")
      q.pairs = q.pairs.map((p) => ({ ...p, imageId: m(p.imageId), labelId: m(p.labelId) }));
    if (q.type === "sort") q.order = q.order.map(m);
  }
  return copy;
}
