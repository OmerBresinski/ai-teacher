// BAKEOFF harness: code checks on one laid-out slide (the harness's own; BAKEOFF/eval has the gates).
import type { Slide, SlideElement } from "@tj/domain/documents";
import { PLACEHOLDER_IMAGE } from "../../packages/slides/src/layouts";
import { cutSubjects, type SubjectBox } from "../../packages/slides/src/templates/index";

export type CheckResult = { slide: number; faults: string[] };
type Box = { x: number; y: number; w: number; h: number };
const W = 960;
const H = 540;
const inter = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const plain = (d: unknown): string => {
  const n = d as { text?: string; content?: unknown[] } | undefined;
  return n?.text ?? (n?.content ?? []).map(plain).join(" ");
};
const label = (e: SlideElement) => {
  const t = plain((e as { doc?: unknown }).doc).trim();
  return t ? `"${t.slice(0, 30)}"` : (e.name ?? e.type);
};
/** A picture that is really there: an image with a real source (not an open slot or a failed find). */
const realPicture = (e: SlideElement) =>
  e.type === "image" &&
  !!(e as { src?: string }).src &&
  (e as { src: string }).src !== PLACEHOLDER_IMAGE;

/** Words that point pupils at a picture or diagram. */
const POINTING =
  /\b(look at|look closely|in the (photo|picture|image|diagram|drawing)|(this|the) (photo|picture|image|diagram|drawing)( shows| below| above)?|on the (picture|photo|diagram)|can you see|what do you notice)\b/i;

export function checkSlide(a: {
  index: number;
  slide: Pick<Slide, "elements"> | undefined;
  over: string[];
  /** drawDiagram's reasons for a diagram that could not draw: fault kind `diagram`. */
  diagram?: string[];
  questions: string[];
  answers: string[] | undefined;
  notesChecked: boolean;
  words: string;
}): CheckResult {
  const faults: string[] = [];
  const s = a.slide;
  if (!s) return { slide: a.index + 1, faults: ["slide not laid out"] };
  for (const o of a.over) faults.push(`overflow: ${o}`);
  if (a.diagram?.length)
    faults.push(`diagram: figure could not be drawn: ${a.diagram.slice(0, 3).join("; ")}`);
  // Clipping: anything past the slide's edge.
  for (const e of s.elements)
    if (e.x < -1 || e.y < -1 || e.x + e.w > W + 1 || e.y + e.h > H + 1)
      faults.push(`clipped: ${label(e)} runs off the slide`);
  // Overlap: text over text, text over a picture or diagram (markers and panels under text are by design).
  const texts = s.elements.filter((e) => e.type === "text");
  const pics = s.elements.filter((e) => e.type === "image");
  for (let i = 0; i < texts.length; i++)
    for (let j = i + 1; j < texts.length; j++) {
      const A = texts[i] as SlideElement;
      const B = texts[j] as SlideElement;
      if (inter(A, B) > 4) faults.push(`overlap: ${label(A)} and ${label(B)}`);
    }
  for (const t of texts)
    for (const p of pics) if (inter(t, p) > 4) faults.push(`overlap: ${label(t)} over a picture`);
  for (let i = 0; i < pics.length; i++)
    for (let j = i + 1; j < pics.length; j++)
      if (inter(pics[i] as Box, pics[j] as Box) > 4) faults.push("overlap: two pictures");
  // PICTURE-FIT gate: a crop that cuts a must-see subject's box (boxes from the vision judge).
  for (const p of pics) {
    const e = p as {
      crop?: { x: number; y: number; w: number; h: number };
      subjects?: SubjectBox[];
    };
    for (const name of cutSubjects(e.crop, e.subjects)) faults.push(`cut: the crop cuts "${name}"`);
  }
  // Dangling: words that point at a picture with no picture on the slide.
  if (POINTING.test(a.words) && !s.elements.some(realPicture))
    faults.push(`dangling: "${a.words.match(POINTING)?.[0]}" with no picture on the slide`);
  // Answerable: every question has an answer from the notes call; one that needs a picture has one.
  if (a.notesChecked && a.questions.length) {
    const got = a.answers?.filter((x) => x.trim()).length ?? 0;
    if (got < a.questions.length)
      faults.push(
        `unanswered: ${a.questions.length - got} of ${a.questions.length} questions have no answer`,
      );
  }
  for (const q of a.questions)
    if (POINTING.test(q) && !s.elements.some(realPicture))
      faults.push(`unanswerable: "${q.slice(0, 40)}" needs a picture the slide does not have`);
  return { slide: a.index + 1, faults: [...new Set(faults)] };
}
