import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { GroupElement, Lesson, SlideElement } from "@tj/domain/documents";
import { setLayoutKit } from "../../model/layout-kit";
import { catcher, loadTextEditor, pointer, renderEditor, seededLesson } from "../test-harness";
import GENERATED from "./fixtures/generated-items-row.json" with { type: "json" };

/*
 * TEACH-110 part w: a pilot slide as live writing closes and saves it (the fixture is the closed
 * items-row slide of a whole-lesson draft run, kept current by the generation package's
 * `draft-sequence.test.ts`) offers the same add, delete and split as a hand-built layout. The
 * live-writing hand-over once renamed its children (`d-s5-Number-0`), unbinding every item.
 */

beforeAll(loadTextEditor);
afterEach(() => {
  cleanup();
  setLayoutKit(null);
});

function generated(): Lesson {
  const lesson = seededLesson();
  const first = lesson.slides[0];
  if (!first) throw new Error("seed");
  first.elements = structuredClone(GENERATED.elements) as unknown as SlideElement[];
  return lesson;
}
const group = (lesson: Lesson) => lesson.slides[0]?.elements[0] as GroupElement;

describe("a generated pilot slide in the editor (TEACH-110 part w)", () => {
  test("it is the generated group: the AI's, its children bound to fields", () => {
    const g = group(generated());
    expect(g.type).toBe("group");
    expect((g as { authoredBy?: string }).authoredBy).toBe("ai");
    expect(g.children.some((c) => c.id === `${g.id}:items.0.text`)).toBe(true);
  });

  test("selecting it offers add, delete and split", async () => {
    const lesson = generated();
    const g = group(lesson);
    const c = g.children.find((x) => x.id === `${g.id}:items.0.name`) as SlideElement;
    const at = { x: g.x + c.x + c.w / 2, y: g.y + c.y + Math.min(c.h / 2, 4) };
    const { container } = renderEditor(lesson);
    fireEvent.pointerDown(catcher(container), pointer(at.x, at.y));
    fireEvent.pointerUp(window, pointer(at.x, at.y));
    await waitFor(() => expect(container.querySelector("[data-layout-controls]")).not.toBeNull(), {
      timeout: 5_000,
    });
    expect(screen.getByRole("button", { name: "Add item after item 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete item 2" })).toBeTruthy();
    await waitFor(() => expect(container.querySelector("[data-layout-over]")).not.toBeNull());
    expect(screen.getByRole("button", { name: "Split slide" })).toBeTruthy();
  });
});
