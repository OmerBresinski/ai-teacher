import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLACEHOLDER_IMAGE } from "@tj/slides/layouts";
import type { Brief } from "./fixes";
import type { VisualAsk, VisualState } from "./materialise";
import { recordedHeld, recordedVisuals, replayServices } from "./replay-fixture";
import { runWriter, type WriterSlide } from "./stage";

/*
 * One layout per slide after its words (genux review, 26 Oct: Great Fire s7/s8 and Romans s6 lost
 * their picture frames at the editable hand-over, the text re-wrapped, and a picture came back at
 * the job's end). A frame the teacher has seen holds in every copy handed over until the job's
 * final deck, which shows the picture or lays the slide once without it.
 */
const B = "y1-science-animals-young";
const DIR = join(import.meta.dir, "fixtures/replay", B);
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8"));
const LOST = 4;

async function run(retryLands: boolean) {
  const rec = recordedVisuals(B);
  const placed = new Set<string>();
  let settled = false;
  const src = (k: string) => `/files/test/${k.replace(":", "-")}.png`;
  const visual = (i: number, key: string, a: VisualAsk): VisualState => {
    const k = `${i}:${key}`;
    if (placed.has(k))
      return { status: "photo", photo: { src: src(k), alt: key, aspect: 1.5, request: key } };
    // Pending while the words stream (the frame shows), failed once the round settles.
    if (i === LOST && a.type === "photo")
      return settled ? { status: "failed" } : { status: "pending" };
    return rec(i, key, a);
  };
  const shown: WriterSlide[] = [];
  let atEditable: WriterSlide | undefined;
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const out = await runWriter({
    brief: read("brief.json") as Brief,
    objectives: (read("objectives.json") as { objectives: { teacher: string }[] }).objectives.map(
      (o) => o.teacher,
    ),
    services: {
      ...replayServices(B),
      writer: async () => ({
        text: (read("main.json") as { text: string }).text,
        finishReason: "stop",
        usd: 0,
        ms: 0,
      }),
    },
    visual,
    held: recordedHeld(B),
    retryable: (i) => i === LOST,
    onSlide: (i, slide) => {
      if (i === LOST) shown.push(slide);
    },
    beforeEditable: async () => {
      settled = true;
    },
    // The tail's retry runs after the hand-over (the gate opens at editable).
    placeMore: async (i, more) => {
      await gate;
      if (retryLands) for (const a of more) placed.add(`${i}:${a.key}`);
    },
    onEditable: (slides) => {
      atEditable = slides[LOST];
      release();
    },
  });
  return { out, shown, atEditable, src: src(`${LOST}:picture`) };
}

const images = (s: WriterSlide | undefined) =>
  (s?.elements ?? []).filter((e) => e.type === "image") as { src?: string }[];
const open = (s: WriterSlide | undefined) =>
  images(s).filter((e) => e.src === PLACEHOLDER_IMAGE).length;

describe("a seen picture frame holds until the job's final deck", () => {
  test("the retry lands: the frame is held at editable, then filled; no re-layout between", async () => {
    const { out, shown, atEditable, src } = await run(true);
    const last = shown.at(-1);
    expect(open(last)).toBeGreaterThan(0);
    // The editable copy keeps the frame the teacher saw: same slots in the same places (ids are only kept stable with drafts on).
    expect(open(atEditable)).toBe(open(last));
    expect(atEditable?.elements.map((e) => [e.type, e.x, e.y, e.w, e.h])).toEqual(
      last?.elements.map((e) => [e.type, e.x, e.y, e.w, e.h]),
    );
    // The final deck shows the picture, never a placeholder.
    const final = out.slides.find((s) => s.id === last?.id);
    expect(open(final)).toBe(0);
    expect(images(final).some((e) => e.src === src)).toBe(true);
  });

  test("the retry fails: the frame is held at editable, and only the final deck lays it out", async () => {
    const { out, shown, atEditable } = await run(false);
    const last = shown.at(-1);
    expect(open(atEditable)).toBe(open(last));
    const final = out.slides.find((s) => s.id === last?.id);
    // Never ships a placeholder: the slide is laid once without its slot.
    expect(open(final)).toBe(0);
  });
});
