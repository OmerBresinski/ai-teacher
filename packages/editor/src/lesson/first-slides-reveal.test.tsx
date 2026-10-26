import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import type { Id, Lesson, Slide } from "@tj/domain/documents";
import { TooltipProvider } from "@tj/ui";
import { StrictMode } from "react";
import {
  createFirstSlidesReveal,
  FIRST_SLIDES_REVEAL_MS,
  revealedKey,
} from "./first-slides-reveal";
import { LessonEditor } from "./LessonEditor";
import { createDraftStore } from "./live-draft";
import { seededLesson } from "./test-harness";
import { FOLLOW_PACE } from "./use-follow-writing";

/** The follow without its reading pauses (its pacing has its own tests in follow-writing). */
const INSTANT = { ...FOLLOW_PACE, readMs: 0, minMs: 0, catchUpReadMs: 0, catchUpMinMs: 0 };

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
// The reveal plays once per lesson per tab; every test starts in a fresh tab.
beforeEach(() => window.sessionStorage.clear());
afterEach(() => window.sessionStorage.clear());

function setup(lesson: Lesson, { strict = false } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(KEY, lesson);
  const store = createDraftStore();
  const saves: Lesson[] = [];
  const tree = (writing: ReadonlySet<Id> | undefined) => {
    const editor = (
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
            followPace={INSTANT}
          />
        </TooltipProvider>
      </QueryClientProvider>
    );
    return strict ? <StrictMode>{editor}</StrictMode> : editor;
  };
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

/**
 * A manual clock for the reveal (never the runner's fake timers: they leak into later files'
 * Testing Library calls on CI). `advance` moves it, then lets one real tick of the reveal run.
 */
function manualClock() {
  let t = 0;
  return {
    now: () => t,
    advance: async (ms: number) => {
      t += ms;
      await new Promise((done) => setTimeout(done, 60));
    },
  };
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
    r.retain();
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
    r.retain();
    expect(r.words("b")).toBe(0);
    r.rush();
    await new Promise((done) => setTimeout(done, 650));
    expect(r.state()).toBe("done");
    expect(r.words("b")).toBeUndefined();
  });

  test("the reveal ends between 10 and 15 seconds after it starts", async () => {
    const clock = manualClock();
    const r = createFirstSlidesReveal(clock.now);
    r.arm([
      { id: "a", words: 4 },
      { id: "b", words: 30 },
    ]);
    const release = r.retain();
    let ended: number | undefined;
    while (clock.now() < 20_000 && ended === undefined) {
      await clock.advance(500);
      if (r.state() === "done") ended = clock.now();
    }
    release();
    expect(ended).toBeGreaterThanOrEqual(10_000);
    expect(ended).toBeLessThanOrEqual(15_000);
  });

  test("slides 1-2 blank at first: it waits, then arms when they get words", () => {
    const r = createFirstSlidesReveal(() => 0);
    r.arm([
      { id: "a", words: 0 },
      { id: "b", words: 0 },
    ]);
    expect(r.state()).toBe("idle");
    r.arm([{ id: "a", words: 4 }, undefined], 0);
    expect(r.state()).toBe("running");
    expect(r.words("a")).toBe(1);
  });

  test("only the title had words: the objectives are paced too when they arrive in the window", () =>
    (async () => {
      const { now, advance } = manualClock();
      const r = createFirstSlidesReveal(now);
      r.arm([{ id: "a", words: 4 }, undefined]);
      const release = r.retain();
      // The title is done and the objectives are not here yet: it keeps watching for them.
      await advance(4_000);
      expect(r.state()).toBe("running");
      expect(r.words("a")).toBe(4);
      r.sync([
        { id: "a", words: 4 },
        { id: "b", words: 20 },
      ]);
      // Cut, not whole: the first word now, the rest by the window's end.
      expect(r.words("b")).toBe(1);
      expect(r.current()).toBe("b");
      await advance((FIRST_SLIDES_REVEAL_MS - 4_000) / 2);
      expect(r.words("b")).toBe(10);
      await advance(FIRST_SLIDES_REVEAL_MS);
      expect(r.state()).toBe("done");
      release();
    })());

  test("objectives arriving after the window show whole", () => {
    let now = 0;
    const r = createFirstSlidesReveal(() => now);
    r.arm([{ id: "a", words: 4 }, undefined], 0);
    now = FIRST_SLIDES_REVEAL_MS + 1;
    r.sync([
      { id: "a", words: 4 },
      { id: "b", words: 20 },
    ]);
    expect(r.words("b")).toBeUndefined();
  });

  test("text that changes mid-reveal is paced by its live word count", () =>
    (async () => {
      const { now, advance } = manualClock();
      const r = createFirstSlidesReveal(now);
      const b = (words: number) => [
        { id: "a", words: 4 },
        { id: "b", words },
      ];
      r.arm(b(20));
      const release = r.retain();
      // Halfway through the objectives' turn.
      await advance(FIRST_SLIDES_REVEAL_MS * 0.625);
      expect(r.words("b")).toBe(10);
      r.sync(b(40));
      await advance(50);
      expect(r.words("b")).toBeGreaterThanOrEqual(20);
      // Words taken away: never more shown than the slide has.
      r.sync(b(5));
      await advance(50);
      expect(r.words("b") ?? 5).toBeLessThanOrEqual(5);
      release();
    })());

  test("the clock stops when the last holder lets go (StrictMode's remount retains it again)", () => {
    const live = new Set<unknown>();
    const [set, clear] = [globalThis.setInterval, globalThis.clearInterval];
    globalThis.setInterval = ((fn: () => void, ms?: number) => {
      const id = set(fn, ms);
      live.add(id);
      return id;
    }) as typeof setInterval;
    globalThis.clearInterval = ((id: ReturnType<typeof setInterval>) => {
      live.delete(id);
      clear(id);
    }) as typeof clearInterval;
    try {
      const r = createFirstSlidesReveal();
      r.arm([{ id: "a", words: 4 }]);
      const first = r.retain();
      first();
      expect(live.size).toBe(0);
      const second = r.retain();
      expect(live.size).toBe(1);
      expect(r.state()).toBe("running");
      second();
      second();
      expect(live.size).toBe(0);
    } finally {
      globalThis.setInterval = set;
      globalThis.clearInterval = clear;
    }
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
    // The reveal ends at once; the view walks on to slide 3 once slides 1 and 2 show in full
    // (TEACH-202 part o: a slide is left only when its words are all on screen).
    const t0 = performance.now();
    while (open(r.container) !== 3 && performance.now() - t0 < 2000) await wait(25);
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

  test("a reload during planning shows the slides whole: no replay", async () => {
    const lesson = newLesson();
    const first = setup(lesson);
    const r = render(first.tree(first.all));
    await wait(300);
    expect(thumbText(r.container, 2)).not.toContain("non-unit");
    r.unmount();
    // The page reloads (same tab) while the writer is still planning: slide 3 has no words yet.
    const again = setup(structuredClone(lesson));
    const r2 = render(again.tree(again.all));
    await wait(50);
    expect(thumbText(r2.container, 1)).toContain("Year 5");
    expect(thumbText(r2.container, 2)).toContain("Find a non-unit fraction of an amount");
  });

  test("storage blocked: the reveal still plays", async () => {
    const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get: () => {
        throw new Error("blocked");
      },
    });
    try {
      const { tree, all } = setup(newLesson());
      const r = render(tree(all));
      await wait(200);
      expect(canvasText(r.container)).not.toContain("Year 5");
    } finally {
      if (original) Object.defineProperty(window, "sessionStorage", original);
    }
  });

  test("slides 1-2 blank when the editor opens: the reveal arms when their words arrive", async () => {
    const lesson = newLesson();
    const blank = structuredClone(lesson);
    blank.slides = [planned("t"), planned("o"), ...blank.slides.slice(2)].map((s, i) =>
      i < 2 ? { ...s, id: (lesson.slides[i] as Slide).id } : s,
    );
    const { tree, all, client } = setup(blank);
    const r = render(tree(all));
    await wait(50);
    act(() => client.setQueryData(KEY, lesson));
    await wait(300);
    // Typed, not whole: the subtitle and the second objective wait their turn.
    expect(thumbText(r.container, 1)).not.toContain("Year 5");
    expect(thumbText(r.container, 2)).not.toContain("non-unit");
    expect(window.sessionStorage.getItem(revealedKey(lesson.id))).not.toBeNull();
  });

  test("unmounting the editor (StrictMode) leaves no reveal clock running", async () => {
    const live = new Map<unknown, number | undefined>();
    const [set, clear] = [globalThis.setInterval, globalThis.clearInterval];
    globalThis.setInterval = ((fn: () => void, ms?: number) => {
      const id = set(fn, ms);
      live.set(id, ms);
      return id;
    }) as typeof setInterval;
    globalThis.clearInterval = ((id: ReturnType<typeof setInterval>) => {
      live.delete(id);
      clear(id);
    }) as typeof clearInterval;
    try {
      const { tree, all } = setup(newLesson(), { strict: true });
      const r = render(tree(all));
      await wait(300);
      // StrictMode's double mount still reveals.
      expect(canvasText(r.container)).toContain("Fractions");
      expect(canvasText(r.container)).not.toContain("Year 5");
      expect([...live.values()].filter((ms) => ms === 50)).toHaveLength(1);
      r.unmount();
      expect([...live.values()].filter((ms) => ms === 50)).toHaveLength(0);
    } finally {
      globalThis.setInterval = set;
      globalThis.clearInterval = clear;
    }
  });

  test("planned slides show as outlines in the strip", async () => {
    const { tree, all } = setup(newLesson());
    const r = render(tree(all));
    await wait(50);
    const thumb3 = r.container.querySelectorAll("[data-navigator] [data-navigator-thumb]")[2];
    expect(thumb3?.querySelector('[data-element-id^="skeleton-"]')).not.toBeNull();
    expect(thumb3?.textContent).toContain("Recall halves and quarters");
  });
});
