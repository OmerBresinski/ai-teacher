import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Lesson } from "@tj/domain/documents";
import { generatedLesson, generatedWorksheet } from "@tj/domain/documents/fixtures";
import { pointer, renderEditor } from "./test-harness";

/*
 * TEACH-133 rows 5–8: the residual badge on the real shell — navigator dots, the footer entry and
 * its popover, the live recomputation after an edit, and the top bar's Worksheet button.
 */

afterEach(cleanup);

const rail = () => screen.getByRole("listbox", { name: "Slides" });
/** The rail's one tab stop: the open slide's row (roving tabindex). */
const activeRow = () => rail().querySelector('[role="option"][tabindex="0"]')?.id;
const rows = () => within(rail()).getAllByRole("option");
const residualDots = () => document.querySelectorAll("[data-residual-badge]");

/** The fixture with its multiple-choice slide (4th) left without a correct option. */
function lessonWithTwoFindings(): Lesson {
  const lesson = generatedLesson();
  const mc = lesson.slides[3];
  if (mc?.question?.type !== "multiple-choice") throw new Error("fixture");
  mc.question = {
    ...mc.question,
    options: mc.question.options.map((o) => ({ ...o, correct: false })),
  };
  return lesson;
}

describe("residual badge", () => {
  test("row 5: dots on the flagged slides, footer count, popover lists both messages", async () => {
    renderEditor(lessonWithTwoFindings(), { worksheet: generatedWorksheet() });
    const dots = residualDots();
    expect(dots).toHaveLength(2);
    expect(rows()[2]?.querySelector("[data-residual-badge]")).not.toBeNull();
    expect(rows()[3]?.querySelector("[data-residual-badge]")).not.toBeNull();
    expect(rows()[3]?.querySelector("[data-residual-badge]")?.getAttribute("data-tone")).toBe(
      "error",
    );
    expect(rows()[2]?.querySelector("[data-residual-badge]")?.getAttribute("aria-label")).toContain(
      "too abstract",
    );

    const footer = screen.getByRole("button", { name: "2 things to check" });
    fireEvent.click(footer);
    const list = await screen.findByRole("list");
    expect(list).toHaveTextContent("too abstract for Year 4");
    expect(list).toHaveTextContent("has no correct option");
    // "Go to slide" lands the rail on the flagged slide.
    fireEvent.click(within(list).getByRole("button", { name: "Go to slide 4" }));
    await waitFor(() => expect(activeRow()).toBe(`slide-opt-${rows()[3]?.dataset.id}`));
  });

  test("row 6: marking an option correct clears slide 4's dot on the autosave cadence", async () => {
    const { read } = renderEditor(lessonWithTwoFindings());
    expect(residualDots()).toHaveLength(2);
    // Open slide 4 and its Answer drawer; tick the first option.
    const fourth = rows()[3];
    if (!fourth) throw new Error("row");
    fireEvent.pointerDown(fourth, pointer(20, 20));
    fireEvent.pointerUp(fourth, pointer(20, 20));
    fireEvent.click(
      within(screen.getByRole("toolbar", { name: "Slide" })).getByRole("button", {
        name: "Answer",
      }),
    );
    const boxes = await screen.findAllByRole("checkbox", { name: /is correct/ });
    fireEvent.click(boxes[0] as HTMLElement);
    const q = read().slides[3]?.question;
    expect(q?.type === "multiple-choice" && q.options[0]?.correct).toBe(true);
    // Not per edit: still two right after the change (the debounce has not fired)…
    expect(residualDots()).toHaveLength(2);
    expect(screen.getByRole("button", { name: "2 things to check" })).toBeVisible();
    // …one once autosave's 800 ms window closes.
    await waitFor(() => expect(residualDots()).toHaveLength(1), { timeout: 3_000 });
    expect(screen.getByRole("button", { name: "1 thing to check" })).toBeVisible();
    expect(rows()[3]?.querySelector("[data-residual-badge]")).toBeNull();
  });

  test("row 7: a lesson without facts or generation state shows no dots and no footer entry", () => {
    const lesson = generatedLesson();
    delete lesson.facts;
    delete lesson.generation;
    renderEditor(lesson);
    expect(residualDots()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /to check$/ })).toBeNull();
  });

  test("a budget finding is listed first and set apart", async () => {
    const lesson = generatedLesson();
    lesson.generation?.findings.unshift({
      check: "budget",
      severity: "error",
      target: {},
      message: "Generation stopped at slide 6: the lesson's cost cap was reached.",
    });
    renderEditor(lesson);
    fireEvent.click(screen.getByRole("button", { name: "2 things to check" }));
    const items = within(await screen.findByRole("list")).getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("data-finding-check", "budget");
    expect(items[0]).toHaveTextContent("cost cap");
  });

  test("row 8: the top bar shows Worksheet when the lesson has one and the app can open it", () => {
    const onOpenWorksheet = mock((_id: string) => {});
    renderEditor(generatedLesson(), { onOpenWorksheet });
    fireEvent.click(screen.getByRole("button", { name: "Worksheet" }));
    expect(onOpenWorksheet).toHaveBeenCalledWith("gen-water-cycle-ws");
  });

  test("no Worksheet button without the artefact", () => {
    const lesson = generatedLesson();
    delete lesson.artefacts;
    renderEditor(lesson, { onOpenWorksheet: () => {} });
    expect(screen.queryByRole("button", { name: "Worksheet" })).toBeNull();
    // A pointer on a row still works with the dots in the thumb corner.
    const second = rows()[1];
    if (!second) throw new Error("row");
    fireEvent.pointerDown(second, pointer(20, 20));
    fireEvent.pointerUp(second, pointer(20, 20));
    expect(activeRow()).toBe(`slide-opt-${second.dataset.id}`);
  });
});
