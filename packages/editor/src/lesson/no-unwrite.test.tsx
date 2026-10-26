/**
 * Judge 638b (13.83 s): the finished objectives slide cleared to "By the end|" and retyped in about
 * 0.7 s. The first-slides reveal had typed it; when the reveal ended (and the slide turned done and
 * was redrawn with its checked pupil lines) the view's catch-up typed it in again. A slide this view
 * has typed never un-writes: changed text updates in place.
 */
import { describe, expect, test } from "bun:test";
import { act, render } from "@testing-library/react";
import type { Slide } from "@tj/domain/documents";
import { createFirstSlidesReveal, FIRST_SLIDES_REVEAL_MS } from "./first-slides-reveal";
import { createDraftStore, LiveSlide, wordCount } from "./live-draft";

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const slideOf = (id: string, ...lines: string[]): Slide =>
  ({
    id,
    kind: "content",
    elements: lines.map((t, i) => ({
      id: `${id}-${i}`,
      type: "text",
      x: 60,
      y: 40 + i * 80,
      w: 800,
      h: 60,
      doc: doc(t),
    })),
  }) as unknown as Slide;
const shownWords = (s: Slide | undefined) => (s ? wordCount(s) : 0);
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

describe("a slide the view typed never un-writes", () => {
  test("the reveal ends, the slide turns done and is redrawn: its words stay, never retyped", async () => {
    let now = 0;
    const reveal = createFirstSlidesReveal(() => now);
    const title = slideOf("a", "Plants");
    const objectives = slideOf("b", "By the end of this lesson I can", "name the parts of a plant");
    reveal.arm(
      [
        { id: "a", words: wordCount(title) },
        { id: "b", words: wordCount(objectives) },
      ],
      0,
    );
    const release = reveal.retain();
    const store = createDraftStore();
    const seen: number[] = [];
    const tree = (slide: Slide, writing: boolean) => (
      <LiveSlide
        store={store}
        slideId="b"
        slide={slide}
        writing={writing}
        reveal={reveal}
        typeIn
        render={(s) => {
          seen.push(shownWords(s));
          return <div data-words={shownWords(s)} />;
        }}
      />
    );
    const r = render(tree(objectives, true));
    // The reveal types the objectives out, then ends while the job still writes.
    now = FIRST_SLIDES_REVEAL_MS * 0.9;
    await wait(80);
    now = FIRST_SLIDES_REVEAL_MS + 1;
    await wait(80);
    const full = wordCount(objectives);
    seen.length = 0;
    r.rerender(tree(objectives, true));
    await wait(100);
    // It turns done and is redrawn with its pupil lines checked (a word more).
    const redrawn = slideOf("b", "By the end of this lesson I can", "name the parts of a plant ✓");
    r.rerender(tree(redrawn, false));
    await wait(400);
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(full);
    release();
  });
});
