// Lesson deck -> plain text for blind judges (docs/eval/PROTOCOL.md). Free, no model calls.
// Input: a lesson document as JSON (the `Lesson` body from @tj/domain/documents: slides with
// positioned elements, `question`, `notes`, and optional `facts.objectives`).
// Usage: bun docs/eval/tools/deck-text.ts <deck.lesson.json> <out.txt>
// Slide by slide, elements in reading order (top to bottom, left to right), then the teacher notes.
// Decoration (accent bars, bullets, cards with no text) is left out; photo/diagram slots show their brief.
import { readFileSync, writeFileSync } from "node:fs";

type Node = { type: string; text?: string; content?: Node[]; attrs?: Record<string, unknown> };
type El = {
  id?: string;
  type: string;
  name?: string;
  x: number;
  y: number;
  doc?: Node;
  label?: string;
  alt?: string;
  [k: string]: unknown;
};
type Question = {
  type?: string;
  options?: { id: string; correct: boolean }[];
  correct?: boolean;
  explanation?: string;
  modelAnswer?: string;
  order?: string[];
  gaps?: { answer: string }[];
  pairs?: { leftElementId?: string; rightElementId?: string; imageId?: string; labelId?: string }[];
};
type Slide = {
  kind: string;
  elements: El[];
  notes?: string;
  question?: Question;
};

const BLOCK = new Set(["paragraph", "heading", "listItem", "blockquote", "codeBlock", "tableRow"]);
function textOf(n: Node | undefined, depth = 0): string {
  if (!n) return "";
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  const inner = (n.content ?? [])
    .map((c) => textOf(c, depth + 1))
    .join(n.type === "tableRow" ? " | " : "");
  if (n.type === "listItem") return `- ${inner.trim()}\n`;
  if (n.type === "tableCell" || n.type === "tableHeader") return inner.trim();
  return BLOCK.has(n.type) ? `${inner.trimEnd()}\n` : inner;
}

// The keyed answer for every QuestionData type in @tj/domain/documents. A type this does not know
// fails the export, so a judge never reads a deck whose answers were silently dropped.
function answerOf(q: Question, byId: (id?: string) => string, slideNo: number): string {
  switch (q.type) {
    case "multiple-choice":
      return (q.options ?? [])
        .filter((o) => o.correct)
        .map((o) => byId(o.id))
        .join("; ");
    case "true-false":
      return q.correct === undefined ? "" : q.correct ? "True" : "False";
    case "open-response":
      return q.modelAnswer ?? "";
    case "sort":
      return (q.order ?? []).map((id) => byId(id)).join(" -> ");
    case "fill-gap":
      return (q.gaps ?? []).map((g) => g.answer).join(", ");
    case "matching":
      return (q.pairs ?? [])
        .map((p) => `${byId(p.leftElementId)} -> ${byId(p.rightElementId)}`)
        .join("; ");
    case "image-match":
      return (q.pairs ?? []).map((p) => `${byId(p.labelId)} -> ${byId(p.imageId)}`).join("; ");
    default:
      throw new Error(`deck-text: slide ${slideNo} has an unknown question type "${q.type}"`);
  }
}

const [inPath, outPath] = process.argv.slice(2);
const lesson = JSON.parse(readFileSync(inPath, "utf8")) as {
  title?: string;
  subject?: string;
  yearGroup?: string;
  brief?: { topic?: string; slideCount?: number; durationMin?: number };
  slides: Slide[];
  facts?: { objectives?: { text: string }[] };
};
const out: string[] = [];
out.push(`LESSON: ${lesson.title ?? lesson.brief?.topic ?? ""}`);
out.push(
  `${lesson.subject ?? ""}, ${lesson.yearGroup ?? ""}, ${lesson.brief?.durationMin ?? "?"} min, ${lesson.slides.length} slides stored`,
);
const objs = lesson.facts?.objectives ?? [];
if (objs.length) out.push(`Objectives:\n${objs.map((o, i) => `  ${i + 1}. ${o.text}`).join("\n")}`);
out.push("");
lesson.slides.forEach((s, i) => {
  out.push(`=== Slide ${i + 1} (${s.kind}) ===`);
  const els = [...s.elements].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const e of els) {
    if (e.name === "Kind tag") continue;
    // A step's number badge is a numeral in a circle, not text on its own (r2 judges read
    // "Step 1 number: 1" as a leak).
    if (/^Step \d+ number$/.test(e.name ?? "")) continue;
    if (e.type === "image") {
      out.push(`[${e.name ?? "image"}: ${e.alt ?? ""}]`);
      continue;
    }
    if (e.name === "Diagram placeholder") {
      out.push(`[diagram placeholder${typeof e.label === "string" ? `: ${e.label}` : ""}]`);
      continue;
    }
    const t = (e.doc ? textOf(e.doc) : "").trim();
    if (e.type === "option") {
      // The key lives on the slide's question, not on the option element.
      const keyed =
        s.question?.type === "multiple-choice" &&
        s.question.options?.some((o) => o.id === e.id && o.correct);
      out.push(`( ) ${t || e.label || ""}${keyed ? "  [correct]" : ""}`);
      continue;
    }
    if (!t) continue;
    // Element names are layout names, not words on the slide: only a revealed element is marked
    // (r2 judges read the answers panel, named "Answers", as "Answers: Answers:" on the face).
    const reveal = (e.revealStep as number | undefined) ? "[revealed on click] " : "";
    out.push(e.name === "Heading" ? `# ${t}` : `${reveal}${t}`);
  }
  const q = s.question;
  if (q) {
    const byId = (id?: string) => {
      const el = s.elements.find((x) => x.id === id);
      if (el?.type === "image") return `[${el.name ?? "image"}: ${el.alt ?? ""}]`;
      return el?.doc ? textOf(el.doc).trim() : "";
    };
    const answer = answerOf(q, byId, i + 1);
    const lines = [answer && `Answer: ${answer}`, q.explanation && `Why: ${q.explanation}`].filter(
      Boolean,
    );
    if (lines.length) out.push(`-- Answer panel (hidden until revealed) --\n${lines.join("\n")}`);
  }
  if (s.notes?.trim()) out.push(`-- Notes --\n${s.notes.trim()}`);
  out.push("");
});
writeFileSync(outPath, out.join("\n"));
