import { mock } from "bun:test";
import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { Lesson, ShapeElement } from "@tj/domain/documents";
import { TooltipProvider } from "@tj/ui";
import { newLesson, uid } from "../model/factories";
import { LessonEditor, type LessonEditorProps } from "./LessonEditor";

/*
 * Shared harness for the editor tests: a QueryClient seeded with a lesson, the providers the shell
 * needs, and `LessonEditor` mounted on it — the same composition the route mounts, so a test drives
 * the real transform layer, keys, navigator and autosave rather than a stub of each.
 */

export const KEY = ["library", "documents", "L1"] as const;

// TanStack batches observer notifications on a setTimeout; `act` cannot flush that, so the hook's
// `lesson` would lag one tick behind the cache in assertions. Deliver them synchronously here.
notifyManager.setScheduler((callback) => callback());

// happy-dom has no layout, so every box is 0x0 and react-virtual (which reads `offsetHeight`)
// renders no rows into a rail with no height. Give the navigator's scroll region a viewport;
// everything else stays at zero, which keeps client coordinates equal to slide points on the canvas.
Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get(this: HTMLElement) {
    return this.getAttribute("role") === "listbox" ? 800 : 0;
  },
});
Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
  configurable: true,
  get(this: HTMLElement) {
    return this.getAttribute("role") === "listbox" ? 212 : 0;
  },
});

export function shape(x: number, y: number, w = 200, h = 100): ShapeElement {
  return { id: uid(), type: "shape", shape: "rect", x, y, w, h };
}

/** A three-slide lesson whose first slide carries two shapes 100pt apart on one row. */
export function seededLesson(): Lesson {
  const lesson = newLesson("Seed lesson");
  const first = lesson.slides[0];
  if (first) first.elements = [shape(100, 100), shape(400, 100)];
  lesson.slides.push(
    { id: uid(), kind: "content", elements: [shape(50, 50)] },
    { id: uid(), kind: "content", elements: [] },
  );
  return lesson;
}

export function renderEditor(
  lesson: Lesson = seededLesson(),
  overrides: Partial<LessonEditorProps> = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(KEY, lesson);
  const onSave = mock((_lesson: Lesson) => Promise.resolve());
  const onBack = mock(() => {});
  const onPresent = mock(() => {});
  const utils = render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <LessonEditor
          lessonId={lesson.id}
          queryKey={KEY}
          queryFn={() => Promise.resolve(lesson)}
          onSave={onSave}
          onBack={onBack}
          onPresent={onPresent}
          {...overrides}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  const read = () => client.getQueryData<Lesson>(KEY) as Lesson;
  return { client, onSave, onBack, onPresent, read, ...utils };
}

/** The transform layer's pointer catcher — where a click on the slide lands. */
export const catcher = (container: HTMLElement): HTMLElement => {
  const el = container.querySelector<HTMLElement>("[data-stage-catcher]");
  if (!el) throw new Error("no stage catcher");
  return el;
};

export const pointer = (x: number, y: number, extra: Record<string, unknown> = {}) => ({
  clientX: x,
  clientY: y,
  button: 0,
  pointerId: 1,
  ...extra,
});

/** Let the transform layer's requestAnimationFrame flush run. */
export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
