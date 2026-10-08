// The writer stage's code checks on one laid-out slide.
import type { Slide, SlideElement } from "@tj/domain/documents";
import { PLACEHOLDER_IMAGE } from "@tj/slides/layouts";
import { cutSubjects, type SubjectBox } from "@tj/slides/templates";
import { pointTaskFault } from "./point-guard";

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

/** Words that point at data, a table or a graph (round 4). */
export const DATA_POINTING =
  /\b(the (results|table|data|graph|curve|chart|tangent|readings|trend|values shown)|(this|that) (table|graph|chart|data|curve)|shown (above|below)|in the (table|graph|chart))\b/i;
/**
 * (r5 y2 s3 "Are these two parts halves?", y2 s5 "shape C", y4 s4 "Read the timeline",
 * y12 s7 "Describe the difference"): words that need a visual the words cannot stand in for.
 */
export const VISUAL_POINTING =
  /\b(these (two |three |four )?(parts|pieces|shapes|pictures|photos|images|groups|counters|halves|quarters|diagrams|objects)|shapes? [A-D]\b|which shape|read the (timeline|time line|graph|table|chart|diagram|map)|(on|in|from|use|study) (the|this) (timeline|time line|map|diagram|picture|photo|image|drawing)|(the|this) (timeline|time line|diagram|picture|photo|image|drawing) (shows|below|above)|look closely|describe the difference(?! between)|what do you notice|can you see)\b/i;
/** Any wording that points at a visual or data (the union, for stripping sentences). */
export const ANY_POINTING = new RegExp(`${DATA_POINTING.source}|${VISUAL_POINTING.source}`, "i");

/** A referent fault, or undefined when the slide shows what its words point at. */
export function referentFault(words: string, hasFigure: boolean): string | undefined {
  if (hasFigure) return undefined;
  const seen = words.match(VISUAL_POINTING)?.[0];
  if (seen) return `dangling: "${seen}" with no picture or diagram on the slide`;
  const hit = words.match(DATA_POINTING)?.[0];
  if (!hit) return undefined;
  if ((words.match(/\d+(?:[.,]\d+)?/g) ?? []).length >= 4) return undefined;
  return `dangling: "${hit}" with no data, table or graph on the slide`;
}

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
  /** the specs of the diagrams drawn on the slide (the count check). */
  specs?: unknown[];
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
  // pointGuard (BAKEOFF base4f, D47): "Point and say", "Look, choose", "shape A" with nothing there.
  if (!s.elements.some(realPicture) && !faults.some((f) => f.startsWith("dangling:"))) {
    const pt = pointTaskFault(a.words);
    if (pt) faults.push(pt);
  }
  // Referent: words that point at data, a
  // table or a graph need a drawn figure or the data itself (at least 4 numbers) on the slide.
  const referent = referentFault(a.words, s.elements.some(realPicture));
  if (referent) faults.push(referent);
  for (const sp of a.specs ?? []) {
    const f = countFault(sp);
    if (f) faults.push(f);
  }
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

/**
 * slides carry no em dashes (Greg 1 Oct). A gloss
 * after one becomes a bracket ("Il est gentil. (He is kind.)", "Mon frère (my brother)"); any
 * other dash becomes a colon, then commas.
 */
export function noEmDash(t: string): string {
  if (!t.includes("—")) return t;
  // One line at a time: "Il est gentil. — He is kind.\nIl est amusant. — He is funny."
  if (t.includes("\n")) return t.split("\n").map(noEmDash).join("\n");
  const parts = t.split(/\s*—\s*/);
  if (parts.length === 2) {
    const [a, b] = parts as [string, string];
    if (b.trim() && b.trim().split(/\s+/).length <= 10) return `${a.trimEnd()} (${b.trim()})`;
  }
  return parts
    .map((p, k) => (k === 0 ? p : `${k === 1 ? ":" : ","} ${p}`))
    .join("")
    .replace(/\s+([:,])/g, "$1");
}

/** Every string in a slide's JSON with `noEmDash` applied. */
export function slideNoEmDash<T>(v: T): T {
  if (typeof v === "string") return noEmDash(v) as T;
  if (Array.isArray(v)) return v.map(slideNoEmDash) as T;
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, slideNoEmDash(x)])) as T;
  return v;
}

/** slides that repeat another (same heading, or words more than 70 % alike). */
export function duplicateFaults(
  slides: { index: number; heading: string; words: string }[],
): Map<number, string> {
  const out = new Map<number, string>();
  const bag = (w: string) => new Set(w.toLowerCase().match(/[\p{L}\d]{3,}/gu) ?? []);
  const norm = (h: string) =>
    h
      .toLowerCase()
      .replace(/[^\p{L}\d]+/gu, " ")
      .trim();
  for (let j = 0; j < slides.length; j++)
    for (let i = 0; i < j; i++) {
      const a = slides[i];
      const b = slides[j];
      if (!a || !b || out.has(b.index)) continue;
      const A = bag(a.words);
      const B = bag(b.words);
      const both = [...A].filter((x) => B.has(x)).length;
      const alike = both / Math.max(1, A.size + B.size - both);
      // A parallel example (the same words, other numbers: "one quarter of 8", "of 20") is not one.
      const nums = (w: string) => [...new Set(w.match(/\d+(?:[.,]\d+)?/g) ?? [])].sort().join(" ");
      const sameNumbers = nums(a.words) === nums(b.words);
      if ((norm(a.heading) && norm(a.heading) === norm(b.heading)) || (alike > 0.7 && sameNumbers))
        out.set(
          b.index,
          `duplicate: repeats s${a.index + 1} ("${a.heading.slice(0, 40)}", ${Math.round(alike * 100)}% alike); make it different or merge it into s${a.index + 1}`,
        );
    }
  return out;
}

const COUNTED: [RegExp, string][] = [
  [/^(counters?|dots?|circles?|beads?|marbles?|sweets?|balls?|buttons?|coins?)$/i, "circle"],
  [/^(squares?|cubes?|blocks?|tiles?|boxes?)$/i, "rect"],
];
/**
 * a labelled drawing's "20 counters" matches what is drawn: all the counters, one colour's
 * worth, the ones inside one outline, or an even share of them.
 */
export function countFault(spec: unknown): string | undefined {
  const s = spec as {
    kind?: string;
    shapes?: {
      type: string;
      fill?: string;
      cx?: number;
      cy?: number;
      x?: number;
      y?: number;
      w?: number;
      h?: number;
    }[];
    labels?: { text: string }[];
  };
  if (s?.kind !== "labelled-diagram" || !Array.isArray(s.shapes) || !Array.isArray(s.labels))
    return;
  for (const l of s.labels) {
    const m = l.text.match(/\b(\d+)\s+([\p{L}]+)/u);
    if (!m) continue;
    const type = COUNTED.find(([re]) => re.test(m[2] ?? ""))?.[1];
    if (!type) continue;
    const n = Number(m[1]);
    const marks = s.shapes.filter((sh) => sh.type === type);
    if (marks.length < 2) continue;
    const ok = new Set<number>([marks.length]);
    const byFill = new Map<string, number>();
    for (const sh of marks) byFill.set(sh.fill ?? "", (byFill.get(sh.fill ?? "") ?? 0) + 1);
    for (const v of byFill.values()) ok.add(v);
    for (let k = 2; k <= 10; k++) if (marks.length % k === 0) ok.add(marks.length / k);
    for (const box of s.shapes.filter((sh) => sh.type === "rect" && type === "circle")) {
      const inside = marks.filter(
        (c) =>
          (c.cx ?? 0) >= (box.x ?? 0) &&
          (c.cx ?? 0) <= (box.x ?? 0) + (box.w ?? 0) &&
          (c.cy ?? 0) >= (box.y ?? 0) &&
          (c.cy ?? 0) <= (box.y ?? 0) + (box.h ?? 0),
      ).length;
      if (inside) ok.add(inside);
    }
    if (!ok.has(n))
      return `count: the label "${l.text}" says ${n} but the drawing shows ${marks.length} ${m[2]}`;
  }
  return undefined;
}
