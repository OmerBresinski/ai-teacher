import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Brief } from "./fixes";
import type { PhotoResult, VisualAsk, VisualState } from "./materialise";
import type { ChatReq, WriterServices } from "./services";
import { runWriter } from "./stage";

/*
 * Replay (TEACH-110 part b): a saved writer output from the pinned evidence runs through the
 * ported stage, with the run's recorded repair and notes answers and its recorded pictures and
 * drawings, and must reproduce that run's saved slides. No model is called.
 *
 * Documented differences, not compared:
 *  - picture `source`, `style` and `period` stamps (the picture director's, TEACH-251);
 *  - element ids (random per layout) and the lesson file's ids and timestamps.
 */

const DIR = join(import.meta.dir, "fixtures/replay");
export type El = Record<string, unknown>;
const read = (b: string, f: string) => readFileSync(join(DIR, b, f), "utf8");
const jsonl = (b: string, f: string) =>
  read(b, f)
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);

export function replayServices(b: string): WriterServices {
  const repairs = jsonl(b, "repair.jsonl");
  // A run whose notes call the budget refused has no notes file: the call fails here too.
  const notesText = read(b, "notes.json");
  const notes = notesText.trim() ? JSON.parse(notesText) : null;
  return {
    log: () => {},
    writer: () => Promise.reject(new Error("the replay never calls the writer")),
    chat: async (r: ChatReq) => {
      if (r.name === "notes" && notes) return { out: notes, usd: 0, ms: 0 };
      if (r.name === "slide") {
        const hit = repairs.find((x) => r.user.includes(JSON.stringify(x.input)));
        if (hit?.out) return { out: hit.out, usd: 0, ms: 0 };
      }
      throw new Error(`no recorded answer for ${r.name}`);
    },
  };
}

/** The run's pictures and drawings by `<slide>:<key>`, as its log and lesson recorded them. */
const aspectOf = (el: El) => {
  const box = Number(el.w) / Number(el.h);
  const c = el.crop as { w: number; h: number } | undefined;
  return c ? (box * c.h) / c.w : box;
};

export function recordedVisuals(b: string) {
  const lesson = JSON.parse(read(b, "lesson.json")) as { slides: { elements: El[] }[] };
  const bySrc = new Map<string, El>();
  for (const s of lesson.slides)
    for (const e of s.elements) if (e.type === "image") bySrc.set(String(e.src), e);
  const out = new Map<string, VisualState>();
  for (const e of jsonl(b, "log.jsonl"))
    if (e.ev === "picture-done") {
      const el = e.ok ? bySrc.get(String(e.src)) : undefined;
      if (!el) {
        out.set(String(e.key), { status: "failed" });
        continue;
      }
      const photo: PhotoResult = {
        src: String(el.src),
        alt: String(el.alt ?? ""),
        // The photo's own shape: a cropped slot shows crop.w x crop.h of it.
        aspect: aspectOf(el),
        request: String(el.request ?? ""),
        ...(el.subjects ? { subjects: el.subjects as PhotoResult["subjects"] } : {}),
      };
      out.set(String(e.key), { status: "photo", photo });
    }
  for (const d of jsonl(b, "diagrams.jsonl"))
    out.set(String(d.key), { status: "diagram", spec: d.spec });
  return (i: number, key: string, _a: VisualAsk): VisualState =>
    out.get(`${i}:${key}`) ?? { status: "failed" };
}

export async function replayRun(
  b: string,
  o: { services?: WriterServices; visual?: ReturnType<typeof recordedVisuals> } = {},
) {
  const brief = JSON.parse(read(b, "brief.json")) as Brief;
  const objectives = (
    JSON.parse(read(b, "objectives.json")) as { objectives: { teacher: string }[] }
  ).objectives.map((o) => o.teacher);
  const main = JSON.parse(read(b, "main.json")) as { text: string; finishReason?: string | null };
  return runWriter({
    brief,
    objectives,
    services: o.services ?? replayServices(b),
    visual: o.visual ?? recordedVisuals(b),
    recordedWriter: { text: main.text, finishReason: main.finishReason ?? null },
  });
}
export const savedSlides = (b: string) =>
  (JSON.parse(read(b, "lesson.json")) as { slides: (El & { elements: El[]; notes?: string })[] })
    .slides;
