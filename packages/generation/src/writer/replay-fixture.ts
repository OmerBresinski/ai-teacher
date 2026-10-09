import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pileSpec } from "@tj/slides/diagrams";
import { CHECKER_OFF, type CheckerFlags } from "./checker-flags";
import type { Brief } from "./fixes";
import type { PhotoResult, VisualAsk, VisualState } from "./materialise";
import type { ChatReq, WriterServices } from "./services";
import { runWriter, type WriterRun } from "./stage";

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
  // The objective repair's recorded answer, when the run made that call.
  const objFile = join(DIR, b, "objective-repair.json");
  const objective = existsSync(objFile) ? JSON.parse(readFileSync(objFile, "utf8")) : null;
  return {
    log: () => {},
    writer: () => Promise.reject(new Error("the replay never calls the writer")),
    chat: async (r: ChatReq) => {
      if (r.name === "notes" && notes) return { out: notes, usd: 0, ms: 0 };
      if (r.name === "objective_repair" && objective) return { out: objective, usd: 0, ms: 0 };
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
  // lostPic: a slide that asked again one subject each records its key twice; the second round's
  // states are read once the stage places it (`placeMore`).
  const log = jsonl(b, "log.jsonl");
  const lostSlides = new Set(
    log.filter((e) => e.ev === "lost-picture").map((e) => Number(e.slide) - 1),
  );
  const late = new Map<string, VisualState>();
  const placedLate = new Set<number>();
  for (const e of log)
    if (e.ev === "picture-done") {
      const key = String(e.key);
      // The image on this key's own slide (one photo can show on two slides, cropped apart).
      const own = lesson.slides[Number(key.split(":")[0])]?.elements.find(
        (x) => x.type === "image" && String(x.src) === String(e.src),
      );
      const el = e.ok ? (own ?? bySrc.get(String(e.src))) : undefined;
      const into = lostSlides.has(Number(key.split(":")[0])) && out.has(key) ? late : out;
      if (!el) {
        into.set(key, { status: "failed" });
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
      into.set(key, { status: "photo", photo });
    }
  for (const d0 of jsonl(b, "diagrams.jsonl")) {
    // The lab's replay drew a reused unshared pile again from its words (pileSpec), as the live
    // stage does in drawWriterDiagram; the recorded spec predates the row rule (5ad4ed59).
    const s0 = d0.spec as { pile?: unknown; alt?: unknown };
    const d = s0?.pile === true ? { ...d0, spec: pileSpec(s0, String(s0.alt ?? "")) ?? s0 } : d0;
    // A diagram that could not be shown and was asked again as a picture of the same thing: the
    // picture is the second round's state.
    const was = out.get(String(d.key));
    if (was && !late.has(String(d.key))) late.set(String(d.key), was);
    out.set(String(d.key), { status: "diagram", spec: d.spec });
  }
  const visual = (i: number, key: string, _a: VisualAsk): VisualState =>
    (placedLate.has(i) ? late.get(`${i}:${key}`) : undefined) ??
    out.get(`${i}:${key}`) ?? { status: "failed" };
  return Object.assign(visual, {
    placeMore: async (i: number) => {
      placedLate.add(i);
    },
  });
}

/**
 * keepPic: the photo the run held back and then shipped (its `keep-pic` log line), read off the
 * slide that shows it.
 */
export function recordedHeld(b: string) {
  const lesson = JSON.parse(read(b, "lesson.json")) as { slides: { id: string; elements: El[] }[] };
  const out = new Map<string, VisualState>();
  for (const e of jsonl(b, "log.jsonl")) {
    if (e.ev !== "keep-pic" || typeof e.key !== "string") continue;
    const i = Number(e.key.split(":")[0]);
    const el = lesson.slides
      .find((s) => s.id === `s${i + 1}`)
      ?.elements.find((x) => x.type === "image");
    if (el)
      out.set(e.key, {
        status: "photo",
        photo: {
          src: String(el.src),
          alt: String(el.alt ?? ""),
          aspect: aspectOf(el),
          request: String(el.request ?? ""),
          ...(el.subjects ? { subjects: el.subjects as PhotoResult["subjects"] } : {}),
        },
      });
  }
  return (i: number, key: string) => out.get(`${i}:${key}`);
}

export async function replayRun(
  b: string,
  o: {
    services?: WriterServices;
    visual?: (i: number, key: string, a: VisualAsk) => VisualState;
    /**
     * Stream the saved writer text through the stage in these pieces (TEACH-110 part h, C1)
     * instead of handing it over whole; `hooks` sees the slides as they open.
     */
    stream?: (text: string) => string[];
    hooks?: Pick<WriterRun, "onAsks" | "onSlide" | "onEditable" | "onReopen">;
    /** Called when the streamed text has all been handed over, before the writer call returns. */
    onStreamEnd?: () => void;
    /** The saved brief changed before the run (a different slide count). */
    brief?: (b: Brief) => Brief;
    /** Flags turned on for this run (`checker-flags.ts`); the rest are off, as the recording ran. */
    checker?: CheckerFlags;
  } = {},
) {
  const saved = JSON.parse(read(b, "brief.json")) as Brief;
  const brief = o.brief ? o.brief(saved) : saved;
  const objectives = (
    JSON.parse(read(b, "objectives.json")) as { objectives: { teacher: string }[] }
  ).objectives.map((o) => o.teacher);
  const main = JSON.parse(read(b, "main.json")) as { text: string; finishReason?: string | null };
  const recorded = recordedVisuals(b);
  const visual = o.visual ?? recorded;
  const services = o.services ?? replayServices(b);
  const split = o.stream;
  return runWriter({
    brief,
    objectives,
    services: split
      ? {
          ...services,
          writer: async (_req, onDelta) => {
            for (const piece of split(main.text)) {
              await Promise.resolve();
              onDelta(piece);
            }
            o.onStreamEnd?.();
            return { text: main.text, finishReason: main.finishReason ?? null, usd: 0, ms: 0 };
          },
        }
      : services,
    visual,
    ...(o.visual ? {} : { placeMore: recorded.placeMore }),
    held: recordedHeld(b),
    // A replay reproduces its recorded run: every flag off unless the caller turns one on.
    checker: { ...CHECKER_OFF, ...o.checker },
    ...(o.hooks ?? {}),
    ...(split
      ? {}
      : { recordedWriter: { text: main.text, finishReason: main.finishReason ?? null } }),
  });
}
export const savedSlides = (b: string) =>
  (JSON.parse(read(b, "lesson.json")) as { slides: (El & { elements: El[]; notes?: string })[] })
    .slides;
