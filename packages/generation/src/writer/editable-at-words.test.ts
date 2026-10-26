import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLACEHOLDER_IMAGE } from "@tj/slides/layouts";
import type { Brief } from "./fixes";
import type { VisualAsk, VisualState } from "./materialise";
import { recordedHeld, recordedVisuals, replayServices } from "./replay-fixture";
import { runWriter, type WriterSlide } from "./stage";

/*
 * TEACH-251 part av (UX ruling 37, "editable when the words finish"): with `editableAtWords` the
 * editable deck is handed over before the pictures settle. A picture still coming is its open slot
 * at editable; each picture that lands afterwards re-lays its slide and hands the deck on
 * (`onLatePicture`), and the settled deck follows (`onPicturesSettled`).
 */
const B = "y1-science-animals-young";
const DIR = join(import.meta.dir, "fixtures/replay", B);
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8"));
const LATE = 4;

const images = (s: WriterSlide | undefined) =>
  (s?.elements ?? []).filter((e) => e.type === "image") as { src?: string }[];
const open = (s: WriterSlide | undefined) =>
  images(s).filter((e) => e.src === PLACEHOLDER_IMAGE).length;

async function run(early: boolean, lands = true) {
  const rec = recordedVisuals(B);
  const placed = new Set<string>();
  let settled = false;
  const src = (k: string) => `/files/test/${k.replace(":", "-")}.png`;
  const visual = (i: number, key: string, a: VisualAsk): VisualState => {
    const k = `${i}:${key}`;
    if (placed.has(k))
      return { status: "photo", photo: { src: src(k), alt: key, aspect: 1.5, request: key } };
    // Pending until the pictures settle; a picture that never comes is failed at the deadline.
    if (i === LATE && a.type === "photo")
      return settled ? { status: "failed" } : { status: "pending" };
    return rec(i, key, a);
  };
  const order: string[] = [];
  let landed: (i: number) => void = () => {};
  let atEditable: WriterSlide | undefined;
  const late: WriterSlide[] = [];
  let settledDeck: WriterSlide | undefined;
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
    bindPictureLanded: (fn) => {
      landed = fn;
    },
    editableAtWords: early,
    beforeEditable: async () => {
      order.push("pictures-start");
      // The slide's picture lands while the pictures settle.
      if (lands) {
        placed.add(`${LATE}:picture`);
        landed(LATE);
      }
      settled = true;
      order.push("pictures-settled");
    },
    onEditable: (slides) => {
      order.push("editable");
      atEditable = slides[LATE];
    },
    onLatePicture: (slides) => {
      late.push(slides[LATE] as WriterSlide);
    },
    onPicturesSettled: (slides) => {
      order.push("settled-saved");
      settledDeck = slides[LATE];
    },
  });
  return { out, order, atEditable, late, settledDeck, src: src(`${LATE}:picture`) };
}

describe("editable when the words finish (part av)", () => {
  test("the deck is editable before the pictures settle, with the coming picture as its slot", async () => {
    const { order, atEditable } = await run(true);
    expect(order.indexOf("editable")).toBeLessThan(order.indexOf("pictures-start"));
    expect(order.at(-1)).toBe("settled-saved");
    expect(open(atEditable)).toBeGreaterThan(0);
  });

  test("a picture landing after editable is handed on in its slide, and the final deck keeps it", async () => {
    const { out, late, settledDeck, atEditable, src } = await run(true);
    expect(late.length).toBeGreaterThan(0);
    const after = late.at(-1);
    expect(after?.id).toBe(atEditable?.id);
    expect(images(after).some((e) => e.src === src)).toBe(true);
    expect(open(after)).toBe(0);
    expect(images(settledDeck).some((e) => e.src === src)).toBe(true);
    const final = out.slides.find((s) => s.id === atEditable?.id);
    expect(images(final).some((e) => e.src === src)).toBe(true);
  });

  test("without the switch, editable still waits for the pictures", async () => {
    const { order, late } = await run(false);
    expect(order.indexOf("pictures-settled")).toBeLessThan(order.indexOf("editable"));
    expect(late).toEqual([]);
  });

  test("a picture that never comes is laid away at the deadline: no slot stays open", async () => {
    const { out, settledDeck, atEditable, late } = await run(true, false);
    expect(open(atEditable)).toBeGreaterThan(0);
    expect(late).toEqual([]);
    expect(open(settledDeck)).toBe(0);
    const final = out.slides.find((s) => s.id === atEditable?.id);
    expect(open(final)).toBe(0);
  });
});
