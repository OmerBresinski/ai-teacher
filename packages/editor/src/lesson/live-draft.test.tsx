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
    // The rest of a started line is laid out, transparent, so its breaks never move (judge 638b).
    expect(JSON.stringify(r.slide)).toContain(
      '"text":" by four","marks":[{"type":"textStyle","attrs":{"color":"transparent"}}]',
    );
    expect(r.at).toBe("e1");
    expect(revealSlide(s, 8).at).toBeUndefined();
    // A box shows with its first word, never empty before it (TEACH-202 part o).
    expect(revealSlide(s, 0).slide.elements.length).toBe(0);
    expect(revealSlide(s, 1).slide.elements.map((e) => e.id)).toEqual(["e0"]);
    expect(revealSlide(s, 6).slide.elements.length).toBe(2);
  });

  test("an untyped run keeps its size and font, only its colour goes (review of #638)", () => {
    const sized = {
      id: "s9",
      kind: "content",
      elements: [
        {
          id: "e0",
          type: "text",
          x: 0,
          y: 0,
          w: 400,
          h: 80,
          doc: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Big bold words here",
                    marks: [
                      { type: "textStyle", attrs: { fontSize: 40, font: "display", highlight: 2 } },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    } as unknown as Slide;
    const json = JSON.stringify(revealSlide(sized, 2).slide);
    expect(json).toContain(
      '"text":" words here","marks":[{"type":"textStyle","attrs":{"fontSize":40,"font":"display","color":"transparent"}}]',
    );
  });

  test("a card shows with the words after it; a picture slot shows from the start", () => {
    const s = slideOf("s4", "Roots hold the plant", "Stems carry water");
    const card = { id: "card", type: "shape", shape: "rounded", x: 0, y: 200, w: 400, h: 80 };
    const pic = { id: "pic", type: "image", src: "x", x: 500, y: 0, w: 300, h: 300 };
    const laid = {
      ...s,
      elements: [s.elements[0], card, s.elements[1], pic],
    } as unknown as typeof s;
    const ids = (n: number) => revealSlide(laid, n).slide.elements.map((e) => e.id);
    expect(ids(2)).toEqual(["e0", "pic"]);
    // The card waits for the first word of the text after it, then shows with it.
    expect(ids(4)).toEqual(["e0", "pic"]);
    expect(ids(5)).toEqual(["e0", "card", "e1", "pic"]);
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

  test("a planned slide whose layout arrives before any word keeps its outline (ruling 278)", async () => {
    const lesson = seededLesson();
    // Planning: slide 3 is the next planned slide, so the follow opens its outline (ruling 278).
    lesson.slides = lesson.slides.slice(0, 3);
    const id = lesson.slides[2]?.id as Id;
    // Planned: only its muted "Planned" line, as the job adds it.
    (lesson.slides[2] as Slide).elements = [
      { ...textEl("p0", "Name four parts"), name: "Planned" } as never,
    ];
    const { store, tree } = setup(lesson);
    const layout: Slide = {
      id,
      kind: "content",
      elements: [
        { ...textEl("h", ""), name: "Heading" } as never,
        { id: "pic", type: "image", src: "x", x: 500, y: 120, w: 400, h: 300 } as never,
      ],
    };
    store.set([{ index: 2, slideId: id, slide: layout }]);
    const r = render(tree(new Set([id])));
    await act(() => settle());
    // The breathing outline, not the empty layout and not a blank slide.
    expect(
      r.container.querySelector('[data-slide-clip] [data-element-id^="skeleton-"]'),
    ).not.toBeNull();
    expect(r.container.querySelector('[data-slide-clip] [data-element-id="pic"]')).toBeNull();
    // Its first word arrives: the region rules take over (title first, picture with it).
    act(() =>
      store.set([
        {
          index: 2,
          slideId: id,
          slide: {
            ...layout,
            elements: [
              { ...textEl("h", "Roots"), name: "Heading" } as never,
              layout.elements[1] as never,
            ],
          },
        },
      ]),
    );
    await act(() => settle());
    expect(
      r.container.querySelector('[data-slide-clip] [data-element-id^="skeleton-"]'),
    ).toBeNull();
    expect(r.container.querySelector('[data-slide-clip] [data-element-id="pic"]')).not.toBeNull();
    expect(canvasText(r.container)).toContain("Roots");
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

  test("reduced motion: the whole draft shows at once, with no caret", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q.includes("reduce"),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      const lesson = seededLesson();
      const id = lesson.slides[1]?.id as Id;
      const { store, tree } = setup(lesson);
      store.set([{ index: 1, slideId: id, slide: slideOf(id, "Arteries carry blood away") }]);
      const r = render(tree(new Set([id])));
      await act(() => new Promise<void>((done) => setTimeout(done, 50)));
      expect(canvasText(r.container)).toContain("Arteries carry blood away");
      act(() =>
        store.set([
          { index: 1, slideId: id, slide: slideOf(id, "Arteries carry blood away from the heart") },
        ]),
      );
      // No typing: the newer draft's words are all there on the next render.
      expect(canvasText(r.container)).toContain("away from the heart");
      expect(document.querySelector("[data-live-caret]")).toBeNull();
    } finally {
      window.matchMedia = original;
    }
  });
});

describe("a draft box that moves glides by a transform, never by its left or top", () => {
  test("the moved box animates `translate` from where it stood; its place changes at once", async () => {
    const lesson = seededLesson();
    const id = lesson.slides[1]?.id as Id;
    const at = (x: number): Slide => ({
      id,
      kind: "content",
      elements: [{ ...textEl("d-card", "Find a quarter"), x }],
    });
    // happy-dom does no layout: offsets read the frame's own left/top.
    const proto = HTMLElement.prototype;
    const left = Object.getOwnPropertyDescriptor(proto, "offsetLeft");
    const top = Object.getOwnPropertyDescriptor(proto, "offsetTop");
    const animate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
    const calls: { id: string; frames: Keyframe[]; options?: KeyframeAnimationOptions }[] = [];
    Object.defineProperty(proto, "offsetLeft", {
      configurable: true,
      get(this: HTMLElement) {
        return Number.parseFloat(this.style.left) || 0;
      },
    });
    Object.defineProperty(proto, "offsetTop", {
      configurable: true,
      get(this: HTMLElement) {
        return Number.parseFloat(this.style.top) || 0;
      },
    });
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      value(this: HTMLElement, frames: Keyframe[], options?: KeyframeAnimationOptions) {
        calls.push({ id: this.dataset.elementId ?? "", frames, options });
        return { cancel() {}, finished: Promise.resolve() };
      },
    });
    try {
      const { store, tree } = setup(lesson);
      store.set([{ index: 1, slideId: id, slide: at(64) }]);
      const r = render(tree(new Set([id])));
      await act(() => settle());
      calls.length = 0;
      act(() => store.set([{ index: 1, slideId: id, slide: at(400) }]));
      await act(() => settle());
      const box = r.container.querySelector<HTMLElement>('[data-element-id="d-card"]');
      expect(box?.style.left).toBe("400px");
      const glide = calls.find((c) => c.id === "d-card" && "translate" in (c.frames[0] ?? {}));
      expect(glide?.frames[0]?.translate).toBe("-336px 0px");
      expect(glide?.frames[1]?.translate).toBe("0 0");
      // The glide leaves nothing behind: no fill holds its last frame and no inline transform stays.
      expect(glide?.options?.fill ?? "none").toBe("none");
      expect(glide?.options?.duration).toBe(220);
      expect(box?.style.translate ?? "").toBe("");
      expect(box?.style.transition ?? "").toBe("");
      // A draft that does not move the box plays no glide.
      calls.length = 0;
      act(() => store.set([{ index: 1, slideId: id, slide: at(400) }]));
      await act(() => settle());
      expect(calls.some((c) => c.id === "d-card" && "translate" in (c.frames[0] ?? {}))).toBe(
        false,
      );
    } finally {
      if (left) Object.defineProperty(proto, "offsetLeft", left);
      if (top) Object.defineProperty(proto, "offsetTop", top);
      if (animate) Object.defineProperty(Element.prototype, "animate", animate);
      else delete (Element.prototype as { animate?: unknown }).animate;
    }
  });
});
