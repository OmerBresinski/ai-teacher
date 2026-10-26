import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Id, Lesson, Slide } from "@tj/domain/documents";
import { TooltipProvider } from "@tj/ui";
import { teacherBusy } from "./follow-mark";
import { LessonEditor, type LessonEditorProps } from "./LessonEditor";
import { createDraftStore } from "./live-draft";
import { seededLesson } from "./test-harness";
import { FOLLOW_PACE } from "./use-follow-writing";

/** The follow without its reading pauses (its pacing has its own tests in follow-writing). */
const INSTANT = { ...FOLLOW_PACE, readMs: 0, minMs: 0, catchUpReadMs: 0, catchUpMinMs: 0 };

/*
 * Live writing P1 (TEACH-202 part e): while the lesson fills, the open slide follows the slide
 * being written; opening another slide or focusing a done slide's canvas pins it; "Follow writing"
 * resumes. The shell's pick (`initialSlideId`) starts the editor pinned.
 */

const KEY = ["lesson", "follow"];

function setup(lesson: Lesson, initial: Partial<LessonEditorProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(KEY, lesson);
  const tree = (writing: ReadonlySet<Id> | undefined) => (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <LessonEditor
          lessonId={lesson.id}
          queryKey={KEY}
          queryFn={() => Promise.resolve(lesson)}
          onSave={() => Promise.resolve()}
          onBack={() => {}}
          onPresent={() => {}}
          writingSlideIds={writing}
          followPace={INSTANT}
          {...initial}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
  const ids = lesson.slides.map((s) => s.id);
  // Slide 2 stays "writing" to the end, as the objectives slide does; `write(k)` marks slide k + 1
  // as the newest slide being written beside it.
  const utils = render(tree(new Set([ids[1] as Id])));
  return {
    ...utils,
    ids,
    write: (k: number) => utils.rerender(tree(new Set([ids[1] as Id, ids[k] as Id]))),
  };
}

/** Every slide with words on it: the follow opens a slide only once it has something to show. */
const worded = (lesson: ReturnType<typeof seededLesson>) => {
  for (const [i, slide] of lesson.slides.entries())
    if (slide.elements.length === 0)
      slide.elements = (lesson.slides[0]?.elements ?? []).map((e) => ({
        ...e,
        id: `${i}-${e.id}`,
      }));
  return lesson;
};

/** A fourth slide with words on it (a copy of slide 1's elements under new ids). */
const fourth = (lesson: ReturnType<typeof seededLesson>) =>
  ({
    id: "s4",
    kind: "content",
    elements: (lesson.slides[0]?.elements ?? []).map((e) => ({ ...e, id: `s4-${e.id}` })),
  }) as (typeof lesson.slides)[number];

const open = (n: number) =>
  screen.getByRole("option", { name: new RegExp(`^Slide ${n}\\b`) }).getAttribute("aria-selected");
const chip = () => screen.queryByRole("button", { name: "Follow writing" });

describe("the editor follows the slide being written", () => {
  test("follows each new slide, pins on a pick, and the chip resumes", () => {
    const lesson = worded(seededLesson());
    lesson.slides.push(fourth(lesson));
    const { write } = setup(lesson);
    // Slide 2 is being written: the editor opens it, not slide 1.
    expect(open(2)).toBe("true");
    expect(chip()).toBeNull();
    write(2);
    expect(open(3)).toBe("true");
    // The teacher opens slide 1 from the strip's keys: it stays open while slide 4 is written.
    fireEvent.keyDown(screen.getByRole("listbox", { name: "Slides" }), { key: "Home" });
    expect(open(1)).toBe("true");
    write(3);
    expect(open(1)).toBe("true");
    // "Follow writing" goes back to the slide being written, and following carries on.
    fireEvent.click(chip() as HTMLElement);
    expect(open(4)).toBe("true");
    expect(chip()).toBeNull();
  });

  test("opening the slide being written does not resume following", () => {
    const lesson = worded(seededLesson());
    lesson.slides.push(fourth(lesson));
    const { write } = setup(lesson);
    write(2);
    fireEvent.keyDown(screen.getByRole("listbox", { name: "Slides" }), { key: "Home" });
    // The teacher goes to the slide being written (slide 3) itself: still pinned.
    const strip = screen.getByRole("listbox", { name: "Slides" });
    fireEvent.keyDown(strip, { key: "ArrowDown" });
    fireEvent.keyDown(strip, { key: "ArrowDown" });
    expect(open(3)).toBe("true");
    write(3);
    expect(open(3)).toBe("true");
    expect(chip()).not.toBeNull();
  });

  test("only the teacher's navigation stops the follow: a key elsewhere or a dialog does not", () => {
    const lesson = worded(seededLesson());
    lesson.slides.push(fourth(lesson));
    const { write } = setup(lesson);
    // P0 26 Oct: a key or click outside the slides (the top bar, the Theme dialog) is not the
    // teacher leaving the slide being written.
    fireEvent.keyDown(document.body, { key: "Tab" });
    fireEvent.pointerDown(document.body);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    fireEvent.pointerDown(dialog);
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    dialog.remove();
    write(2);
    expect(open(3)).toBe("true");
    expect(chip()).toBeNull();
    // A wheel in the strip is: the follow stops there.
    fireEvent.wheel(screen.getByRole("listbox", { name: "Slides" }));
    write(3);
    expect(open(3)).toBe("true");
    expect(chip()).not.toBeNull();
  });

  test("between content slides an empty next slide is not opened: the view stays on the last words", () => {
    const lesson = worded(seededLesson());
    lesson.slides.push({ id: "s4", kind: "content", elements: [] });
    const drafts = createDraftStore();
    const { write, ids } = setup(lesson, { drafts });
    // The writer is on the content slides: slide 3's draft has words.
    const text = {
      id: "d-3-h-0",
      type: "text",
      x: 64,
      y: 46,
      w: 832,
      h: 80,
      doc: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Halves of 12" }] }],
      },
      style: { preset: "body", fontSize: 28 },
    } as Slide["elements"][number];
    const words = { ...(lesson.slides[2] as Slide), elements: [text] };
    act(() => drafts.set([{ index: 2, slideId: ids[2] as Id, slide: words }]));
    write(2);
    expect(open(3)).toBe("true");
    // Slide 4 is next but has nothing on it yet: slide 3 stays painted (its typing ends on screen).
    write(3);
    expect(open(3)).toBe("true");
  });

  test("before the writer's first content words, the next planned slide opens as an outline", () => {
    const lesson = worded(seededLesson());
    // Planning: slides 3 and 4 are planned blanks (no words of their own yet).
    (lesson.slides[2] as Slide).elements = [];
    lesson.slides.push({ id: "s4", kind: "content", elements: [] });
    const { write, container } = setup(lesson);
    write(2);
    expect(open(3)).toBe("true");
    // No draft has words yet: the view moves on to slide 4's outline (TEACH-202 part f, amended).
    write(3);
    expect(open(4)).toBe("true");
    expect(
      container.querySelector('[data-slide-clip] [data-element-id^="skeleton-"]'),
    ).not.toBeNull();
  });

  test("slide 3 written and no draft streaming (lead undefined): the next outline does not open", () => {
    const lesson = worded(seededLesson());
    lesson.slides.push({ id: "s4", kind: "content", elements: [] });
    const { write } = setup(lesson, { drafts: createDraftStore() });
    // Slide 3's words are saved; the draft store is empty between slides, so `lead` is undefined.
    write(2);
    expect(open(3)).toBe("true");
    write(3);
    expect(open(3)).toBe("true");
    expect(open(4)).toBe("false");
  });

  test("following never moves focus, even with a strip row focused", () => {
    const lesson = worded(seededLesson());
    lesson.slides.push(fourth(lesson));
    const { write } = setup(lesson);
    const row = screen.getByRole("option", { name: /^Slide 1\b/ });
    row.focus();
    expect(document.activeElement).toBe(row);
    write(2);
    expect(open(3)).toBe("true");
    expect(document.activeElement).toBe(row);
    write(3);
    expect(open(4)).toBe("true");
    expect(document.activeElement).toBe(row);
  });

  test("the chip's dot pulses only without reduced motion", () => {
    const lesson = worded(seededLesson());
    const { write } = setup(lesson, { initialSlideId: seededLesson().slides[0]?.id });
    write(2);
    const dot = chip()?.querySelector("span") as HTMLElement;
    expect(dot.className).toContain("motion-safe:animate-pulse");
    expect(dot.className.split(" ")).not.toContain("animate-pulse");
  });

  test("the teacher is busy while typing, selecting or with a picker open", () => {
    // Start from a quiet page: earlier tests may leave a portal, a focus or a selection behind.
    document.body.replaceChildren();
    document.getSelection()?.removeAllRanges();
    (document.activeElement as HTMLElement | null)?.blur?.();
    expect(teacherBusy()).toBe(false);
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    expect(teacherBusy()).toBe(true);
    input.blur();
    input.remove();
    const p = document.createElement("p");
    p.textContent = "some words";
    document.body.append(p);
    const range = document.createRange();
    range.selectNodeContents(p);
    document.getSelection()?.addRange(range);
    expect(teacherBusy()).toBe(true);
    document.getSelection()?.removeAllRanges();
    p.remove();
    const popper = document.createElement("div");
    popper.setAttribute("data-radix-popper-content-wrapper", "");
    document.body.append(popper);
    expect(teacherBusy()).toBe(true);
    popper.remove();
    expect(teacherBusy()).toBe(false);
  });

  test("the shell's pick opens pinned, with the chip to follow", () => {
    const lesson = worded(seededLesson());
    const { write } = setup(lesson, { initialSlideId: seededLesson().slides[0]?.id });
    // An id from another deck: opens slide 1, pinned (the shell's pick was not "follow").
    write(2);
    expect(open(1)).toBe("true");
    expect(chip()).not.toBeNull();
  });
});
