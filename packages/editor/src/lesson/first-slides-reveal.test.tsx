import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import type { Id, Lesson, Slide } from "@tj/domain/documents";
import { TooltipProvider } from "@tj/ui";
import { createFirstSlidesReveal, FIRST_SLIDES_REVEAL_MS } from "./first-slides-reveal";
import { LessonEditor } from "./LessonEditor";
import { createDraftStore } from "./live-draft";
import { seededLesson } from "./test-harness";

/*
 * First-generation pacing (Greg, 20 Oct 2026, amending TEACH-202 part f): a new lesson's title and
 * objectives slides type out over FIRST_SLIDES_REVEAL_MS while the writer plans; planned slides
 * show as outlines. Presentation only: never the document, never later slides, never a reopen.
 */

const doc = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text }] }],
});
const textEl = (id: string, text: string, y = 46) =>
  ({
    id,
    type: "text",
    x: 64,
    y,
    w: 832,
    h: 80,
    doc: doc(text),
    style: { preset: "body", fontSize: 28 },
  }) as Slide["elements"][number];
const planned = (id: string): Slide =>
  ({
    id,
    kind: "content",
    notes: "",
    elements: [{ ...textEl(`${id}-planned`, "Recall halves and quarters", 470), name: "Planned" }],
  }) as Slide;

const TITLE = "Fractions of amounts";
const OBJECTIVES = ["Find a unit fraction of an amount", "Find a non-unit fraction of an amount"];

/** A lesson as the writer saves it at its start: title and objectives, then planned blanks. */
function newLesson(): Lesson {
  const lesson = seededLesson();
  const [one, two] = lesson.slides as [Slide, Slide];
  one.elements = [textEl("t0", TITLE), textEl("t1", "Year 5", 160)];
  two.elements = OBJECTIVES.map((o, i) => textEl(`o${i}`, o, 46 + i * 100));
  lesson.slides = [one, two, planned("s3"), planned("s4")];
  return lesson;
}

const KEY = ["lesson", "reveal"];
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
  const all = new Set(lesson.slides.map((s) => s.id));
  return { client, store, saves, tree, all };
}

const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const canvasText = (c: HTMLElement) => c.querySelector("[data-slide-clip]")?.textContent ?? "";
const thumbText = (c: HTMLElement, n: number) =>
  c.querySelectorAll("[data-navigator] [data-navigator-thumb]")[n - 1]?.textContent ?? "";
const open = (c: HTMLElement) =>
  [...c.querySelectorAll("[data-navigator] [role=option]")].findIndex(
    (el) => el.getAttribute("aria-selected") === "true",
  ) + 1;

function withReducedMotion<T>(fn: () => Promise<T>): Promise<T> {
  const original = window.matchMedia;
  window.matchMedia = ((q: string) => ({
    matches: q.includes("reduce"),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  return fn().finally(() => {
    window.matchMedia = original;
  });
}

describe("createFirstSlidesReveal", () => {
  test("title, then objectives, over the named duration; nothing after it", async () => {
    let now = 0;
    const r = createFirstSlidesReveal(() => now);
    const tick = () => new Promise((done) => setTimeout(done, 80));
    r.arm(
      [
        { id: "a", words: 4 },
        { id: "b", words: 20 },
      ],
      0,
    );
    r.start();
    expect(r.state()).toBe("running");
    expect(r.current()).toBe("a");
    expect(r.words("a")).toBe(1);
    expect(r.words("b")).toBe(0);
    // A quarter in: the title is whole and the objectives start.
    now = FIRST_SLIDES_REVEAL_MS * 0.25;
    await tick();
    expect(r.words("a")).toBe(4);
    expect(r.words("b")).toBe(1);
    expect(r.current()).toBe("b");
    now = FIRST_SLIDES_REVEAL_MS * 0.625;
    await tick();
    expect(r.words("b")).toBe(10);
    // At the named duration it is over: every word shows.
    now = FIRST_SLIDES_REVEAL_MS;
    await tick();
    expect(r.state()).toBe("done");
    expect(r.words("a")).toBeUndefined();
    expect(r.words("b")).toBeUndefined();
  });

  test("rush finishes within half a second of real content arriving", async () => {
    const r = createFirstSlidesReveal();
    r.arm([
      { id: "a", words: 4 },
      { id: "b", words: 40 },
    ]);
    r.start();
    expect(r.words("b")).toBe(0);
    r.rush();
    await new Promise((done) => setTimeout(done, 650));
    expect(r.state()).toBe("done");
    expect(r.words("b")).toBeUndefined();
  });

  test("the reveal lasts 10-15 s", () => {
    expect(FIRST_SLIDES_REVEAL_MS).toBeGreaterThanOrEqual(10_000);
    expect(FIRST_SLIDES_REVEAL_MS).toBeLessThanOrEqual(15_000);
  });
});

describe("a new lesson's first two slides type out, presentation only", () => {
  test("the title types out first on the canvas and in the strip; the save never sees it", async () => {
    const lesson = newLesson();
    const { tree, all, client, saves } = setup(lesson);
    const r = render(tree(all));
    await wait(300);
    expect(open(r.container)).toBe(1);
    // A word or two of the title, not all of it, and the objectives wait their turn.
    expect(canvasText(r.container)).toContain("Fractions");
    expect(canvasText(r.container)).not.toContain("Year 5");
    expect(thumbText(r.container, 2)).not.toContain("non-unit");
    // The document and the saves keep every word.
    expect(JSON.stringify(client.getQueryData(KEY))).toContain("Find a non-unit fraction");
    expect(saves.every((l) => JSON.stringify(l).includes(TITLE))).toBe(true);
    // The job ends: everything shows at once, editable.
    r.rerender(tree(undefined));
    await wait(50);
    expect(canvasText(r.container)).toContain("Year 5");
    expect(thumbText(r.container, 2)).toContain("Find a non-unit fraction of an amount");
  });

  test("early content: slide 3's words end the reveal at once and the view moves on", async () => {
    const lesson = newLesson();
    const { tree, all, store } = setup(lesson);
    const r = render(tree(all));
    await wait(200);
    expect(thumbText(r.container, 2)).not.toContain("non-unit");
    act(() =>
      store.set([
        {
          index: 2,
          slideId: "s3",
          slide: { id: "s3", kind: "content", elements: [textEl("d-s3-h-0", "Halves of 12")] },
        },
      ]),
    );
    await wait(50);
    // The view does not wait for the reveal: it opens slide 3 now.
    expect(open(r.container)).toBe(3);
    await wait(650);
    expect(thumbText(r.container, 1)).toContain("Year 5");
    expect(thumbText(r.container, 2)).toContain("Find a non-unit fraction of an amount");
  });

  test("a finished lesson opened later never animates", async () => {
    const { tree } = setup(newLesson());
    const r = render(tree(undefined));
    await wait(100);
    expect(canvasText(r.container)).toContain("Year 5");
    expect(thumbText(r.container, 2)).toContain("Find a non-unit fraction of an amount");
  });

  test("a lesson reopened mid-run (slide 3 written) never animates", async () => {
    const lesson = newLesson();
    (lesson.slides[2] as Slide).elements = [textEl("w3", "Halves of 12")];
    const { tree, all } = setup(lesson);
    const r = render(tree(all));
    await wait(100);
    expect(thumbText(r.container, 1)).toContain("Year 5");
    expect(thumbText(r.container, 2)).toContain("Find a non-unit fraction of an amount");
  });

  test("reduced motion: both slides show whole at once", () =>
    withReducedMotion(async () => {
      const { tree, all } = setup(newLesson());
      const r = render(tree(all));
      await wait(100);
      expect(thumbText(r.container, 1)).toContain("Year 5");
      expect(thumbText(r.container, 2)).toContain("Find a non-unit fraction of an amount");
      expect(document.querySelector("[data-live-caret]")).toBeNull();
    }));

  test("planned slides show as outlines in the strip", async () => {
    const { tree, all } = setup(newLesson());
    const r = render(tree(all));
    await wait(50);
    const thumb3 = r.container.querySelectorAll("[data-navigator] [data-navigator-thumb]")[2];
    expect(thumb3?.querySelector('[data-element-id^="skeleton-"]')).not.toBeNull();
    expect(thumb3?.textContent).toContain("Recall halves and quarters");
  });
});
