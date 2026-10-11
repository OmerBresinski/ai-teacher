import { describe, expect, test } from "bun:test";
import type { VisualAsk, VisualState } from "./materialise";
import { recordedVisuals, replayRun } from "./replay-fixture";

/*
 * Live writing P2 (TEACH-202 part e): a picture the director places while the words still stream
 * re-lays its slide and hands it over at once (`bindPictureLanded` → `onSlide`), instead of waiting
 * for the editable deck. A slide that was never opened is not handed over.
 */

const LESSON = "y1-science-animals-young";

const pieces = (text: string) => {
  const out: string[] = [];
  for (let at = 0; at < text.length; at += 48) out.push(text.slice(at, at + 48));
  return out;
};
type El = { type?: string; src?: string };

describe("a picture placed while the stream runs", () => {
  test("its slide is handed over again with the picture before the stream ends", async () => {
    const recorded = recordedVisuals(LESSON);
    const placed = new Set<number>();
    const visual = (i: number, key: string, a: VisualAsk): VisualState =>
      placed.has(i) ? recorded(i, key, a) : { status: "pending" };
    let landed: ((i: number) => void) | undefined;
    let target = -1;
    let ended = false;
    const withPictureBeforeEnd: number[] = [];
    await replayRun(LESSON, {
      visual,
      stream: pieces,
      onStreamEnd: () => {
        ended = true;
      },
      hooks: {
        bindPictureLanded: (fn) => {
          landed = fn;
        },
        onAsks: (i, asks) => {
          if (target >= 0 || i < 2) return;
          const photo = asks.find(
            (a) => a.type === "photo" && recorded(i, a.key, a).status === "photo",
          );
          if (!photo) return;
          target = i;
          // The director places it a moment later, while the stream is still running.
          queueMicrotask(() => {
            placed.add(i);
            landed?.(i);
          });
        },
        onSlide: (i, slide) => {
          if (ended || i !== target) return;
          const img = (slide.elements as El[]).find(
            (e) => e.type === "image" && e.src && !e.src.startsWith("data:image/svg+xml"),
          );
          if (img) withPictureBeforeEnd.push(i);
        },
      },
    });
    expect(target).toBeGreaterThanOrEqual(2);
    expect(withPictureBeforeEnd).toContain(target);
  });

  test("a slide that never opened is not handed over", async () => {
    let landed: ((i: number) => void) | undefined;
    const shown: number[] = [];
    await replayRun(LESSON, {
      stream: pieces,
      hooks: {
        bindPictureLanded: (fn) => {
          landed = fn;
          // Before any slide opens: nothing to lay.
          fn(5);
        },
        onSlide: (i) => shown.push(i),
      },
    });
    expect(landed).toBeDefined();
    expect(shown.indexOf(5)).toBeGreaterThan(shown.indexOf(4));
  });
});
