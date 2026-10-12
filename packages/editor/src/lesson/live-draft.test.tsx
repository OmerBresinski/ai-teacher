import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import type { Id, Lesson, Slide } from "@tj/domain/documents";
import { TooltipProvider } from "@tj/ui";
import { LessonEditor } from "./LessonEditor";
import { createDraftStore, revealSlide, wordCount } from "./live-draft";
import { seededLesson } from "./test-harness";

/*
 * Live writing (TEACH-202 part f, ADR 0039): a slide being written shows its newest draft in the
 * editor's canvas; the saved slide always wins once the slide is done; the hand-over keeps the
 * canvas mounted; a draft never reaches the document, a save or a done slide.
 */

const doc = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text }] }],
});
const textEl = (id: string, text: string) =>
  ({
    id,
    type: "text",
    x: 64,
    y: 46,
    w: 832,
    h: 120,
    doc: doc(text),
    style: { preset: "body", fontSize: 28 },
  }) as Slide["elements"][number];
const slideOf = (id: string, ...texts: string[]): Slide => ({
  id,
  kind: "content",
  elements: texts.map((t, i) => textEl(`e${i}`, t)),
});

describe("revealSlide", () => {
  test("shows the first n words in reading order and names the box the caret goes in", () => {
    const s = slideOf("s3", "Find a quarter of 24", "Divide by four");
    expect(wordCount(s)).toBe(8);
    const r = revealSlide(s, 6);
    expect(JSON.stringify(r.slide)).toContain('"text":"Find a quarter of 24"');
    expect(JSON.stringify(r.slide)).toContain('"text":"Divide"');
    expect(JSON.stringify(r.slide)).not.toContain("four");
    expect(r.at).toBe("e1");
    expect(revealSlide(s, 8).at).toBeUndefined();
    // Boxes show before their words: an empty box keeps its place.
    expect(revealSlide(s, 0).slide.elements.length).toBe(2);
  });
});

const KEY = ["lesson", "live"];

function setup(lesson: Lesson) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(KEY, lesson);
  const store = createDraftStore();
  const saves: Lesson[] = [];
  const tree = (writing: ReadonlySet<Id> | undefined) => (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <LessonEditor
          lessonId={lesson.id}
          queryKey={KEY}
          queryFn={() => Promise.resolve(lesson)}
          onSave={(l) => {
            saves.push(l);
            return Promise.resolve();
          }}
          onBack={() => {}}
          onPresent={() => {}}
          writingSlideIds={writing}
          drafts={store}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
  return { client, store, saves, tree };
}

const settle = () => new Promise<void>((r) => setTimeout(r, 500));
const canvasText = (c: HTMLElement) => c.querySelector("[data-slide-clip]")?.textContent ?? "";

describe("the editor shows a writing slide's drafts and hands over to the saved slide", () => {
  test("draft while writing, saved slide after, same canvas, nothing saved or merged", async () => {
    const lesson = seededLesson();
    const id = lesson.slides[1]?.id as Id;
    const saved = lesson.slides[1] as Slide;
    saved.elements = [textEl("e0", "The heart pumps blood around the body")];
    const { client, store, saves, tree } = setup(lesson);
    store.set([{ index: 1, slideId: id, slide: slideOf(id, "The heart pumps") }]);
    const r = render(tree(new Set([id])));
    // The editor follows to the writing slide and types its draft out on animation frames.
    await act(() => settle());
    expect(canvasText(r.container)).toContain("The heart pumps");
    expect(canvasText(r.container)).not.toContain("around the body");
    expect(r.container.querySelector(`[data-live-slide="${id}"]`)).not.toBeNull();
    const clip = r.container.querySelector("[data-slide-clip]");
    // A newer draft grows the words (shown at once here: the typewriter runs on animation frames).
    act(() => store.set([{ index: 1, slideId: id, slide: slideOf(id, "The heart pumps blood") }]));
    await act(() => settle());
    expect(canvasText(r.container)).toContain("The heart pumps blood");
    expect(r.container.querySelector("[data-slide-clip]")).toBe(clip);
    // The slide is done: the saved copy shows, whatever the drafts say, in the same canvas.
    r.rerender(tree(undefined));
    expect(canvasText(r.container)).toContain("The heart pumps blood around the body");
    expect(r.container.querySelector("[data-live-slide]")).toBeNull();
    expect(r.container.querySelector("[data-slide-clip]")).toBe(clip);
    // The draft never entered the document or a save.
    const kept = client.getQueryData<Lesson>(KEY);
    expect(JSON.stringify(kept)).not.toContain('"The heart pumps blood"');
    expect(saves.every((l) => !JSON.stringify(l).includes('"The heart pumps blood"'))).toBe(true);
  });

  test("a slide turning done before its saved words arrive keeps its draft until they do", async () => {
    const lesson = seededLesson();
    const id = lesson.slides[1]?.id as Id;
    (lesson.slides[1] as Slide).elements = [];
    const { client, store, tree } = setup(lesson);
    store.set([
      { index: 1, slideId: id, slide: slideOf(id, "Blood flows to the lungs"), final: true },
    ]);
    const r = render(tree(new Set([id])));
    await act(() => settle());
    expect(canvasText(r.container)).toContain("Blood flows to the lungs");
    // Done, but the open document still has the blank copy: the draft holds, no blank frame.
    r.rerender(tree(undefined));
    expect(canvasText(r.container)).toContain("Blood flows to the lungs");
    // The saved words arrive: the saved copy takes over.
    const next = structuredClone(client.getQueryData<Lesson>(KEY) as Lesson);
    (next.slides[1] as Slide).elements = [textEl("e0", "Blood flows to the lungs and back")];
    await act(async () => {
      client.setQueryData(KEY, next);
      await settle();
    });
    r.rerender(tree(undefined));
    expect(r.container.querySelector("[data-live-slide]")).toBeNull();
  });

  test("a draft for a done slide is ignored: the teacher's copy shows", () => {
    const lesson = seededLesson();
    const done = lesson.slides[0] as Slide;
    done.elements = [textEl("e0", "My own words")];
    const { store, tree } = setup(lesson);
    store.set([{ index: 0, slideId: done.id, slide: slideOf(done.id, "A stale draft") }]);
    const r = render(tree(new Set([lesson.slides[2]?.id as Id])));
    act(() => {
      // Open slide 1 (done) from the strip's keys.
      r.container
        .querySelector("[role=listbox]")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    });
    expect(canvasText(r.container)).toContain("My own words");
    expect(canvasText(r.container)).not.toContain("A stale draft");
  });
});
