import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Id, Lesson } from "@tj/domain/documents";
import { TooltipProvider } from "@tj/ui";
import { LessonEditor, type LessonEditorProps } from "./LessonEditor";
import { seededLesson } from "./test-harness";

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

const open = (n: number) =>
  screen.getByRole("option", { name: new RegExp(`^Slide ${n}\\b`) }).getAttribute("aria-selected");
const chip = () => screen.queryByRole("button", { name: "Follow writing" });

describe("the editor follows the slide being written", () => {
  test("follows each new slide, pins on a pick, and the chip resumes", () => {
    const lesson = seededLesson();
    lesson.slides.push({ id: "s4", kind: "content", elements: [] });
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

  test("the shell's pick opens pinned, with the chip to follow", () => {
    const lesson = seededLesson();
    const { write } = setup(lesson, { initialSlideId: seededLesson().slides[0]?.id });
    // An id from another deck: opens slide 1, pinned (the shell's pick was not "follow").
    write(2);
    expect(open(1)).toBe("true");
    expect(chip()).not.toBeNull();
  });
});
