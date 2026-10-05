/**
 * LAYOUT-TEST (lab): the geometry of every T3 slide type, read from the real layout code
 * (adapt -> renderWritten -> materialiseSlide, and asFigureFull for the big diagram), for the
 * ZV arm's contact sheet. Prints JSON: per form, the slide's elements with their rects.
 */
import { asFigureFull, getTheme, materialiseSlide } from "@tj/slides";
import { renderWritten } from "./fit";
import { adapt, withPictureZone } from "./simple";

const themeId = process.argv[2] ?? "chalk";
const theme = getTheme(themeId);
const meta = { promptVersion: "sheet", model: "code", at: "1970-01-01T00:00:00.000Z" };
let n = 0;
const ids = () => `e${n++}`;
const L = (k: number, w = "A line of slide text about this long") =>
  Array.from({ length: k }, () => w);
const qa = (k: number) =>
  Array.from({ length: k }, (_, i) => ({ question: `Question ${i + 1}?`, answer: "Answer" }));
const photo = { kind: "photo", subject: "x", named: null };
const FORMS: [string, Record<string, unknown>][] = [
  ["explain", { body: L(3) }],
  ["explain-callout", { body: L(3) }],
  ["list", { body: L(1), items: L(4, "A point") }],
  ["compare", { items: ["Left: text", "Right: text"] }],
  ["sequence", { items: L(4, "A step") }],
  ["picture", { form: "photo", body: L(3), picture: photo }],
  ["worked-example", { items: L(3, "A step"), questions: qa(1) }],
  ["hinge", { items: L(4, "An option"), questions: qa(1) }],
  ["true-false", { questions: qa(1) }],
  ["matching", { items: ["a = b", "c = d", "e = f"] }],
  ["fill-gap", { questions: [{ question: "A ___ sentence", answer: "gap" }] }],
  ["sort", { items: L(4, "An item") }],
  ["open-response", { questions: qa(1) }],
  ["discussion", { questions: qa(1) }],
  ["vocabulary", { items: L(4, "term: definition") }],
  ["starter", { questions: qa(3) }],
  ["check", { questions: qa(3) }],
  ["exit-ticket", { questions: qa(3) }],
  ["big-diagram", { form: "photo", body: L(1), picture: photo }],
];
const out: unknown[] = [];
for (const [name, f] of FORMS) {
  const s = {
    form: name,
    heading: "A slide heading",
    body: [],
    items: [],
    questions: [],
    picture: null,
    notes: "",
    ...f,
  } as never;
  try {
    const a = adapt(name === "picture" || name === "big-diagram" ? withPictureZone(s) : s);
    const r = renderWritten(a.form, a.layout, a.out);
    let slide = materialiseSlide(r.spec, themeId, meta, ids, r.variant, r.structure);
    if (name === "big-diagram") slide = asFigureFull(slide, theme) ?? slide;
    out.push({
      form: name,
      palette: a.form,
      layout: a.layout,
      elements: (slide.elements as Record<string, unknown>[]).map((e) => ({
        type: e.type,
        name: e.name,
        x: e.x,
        y: e.y,
        w: e.w,
        h: e.h,
        src: e.src,
        preset: (e.style as { preset?: string } | undefined)?.preset,
        fontSize: (e.style as { fontSize?: number } | undefined)?.fontSize,
        lineHeight: (e.style as { lineHeight?: number } | undefined)?.lineHeight,
        reveal: e.revealStep,
      })),
    });
  } catch (e) {
    out.push({ form: name, error: String(e).slice(0, 200) });
  }
}
console.log(JSON.stringify({ theme: themeId, size: { w: 1280, h: 720 }, forms: out }, null, 1));
