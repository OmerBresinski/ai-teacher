import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import {
  type Lesson,
  richDocToPlainText,
  type ShapeElement,
  withSetAnswer,
} from "@tj/domain/documents";
import { codedSetSlide } from "@tj/domain/documents/fixtures";
import { renderEditor, seededLesson } from "../test-harness";

/* TEACH-101: the Answer drawer on a coded question set. */

afterEach(cleanup);

const toolbar = (name: string) => screen.getByRole("toolbar", { name });

function withSet(slide = codedSetSlide()): Lesson {
  const lesson = seededLesson();
  lesson.slides = [slide, ...lesson.slides];
  return lesson;
}

const boxOf = (lesson: Lesson) =>
  lesson.slides[0]?.elements.find((e) => e.id === "set-answers") as ShapeElement;

const state = (lesson: Lesson) => {
  const q = lesson.slides[0]?.question as { items: { answer: string }[] };
  return {
    item: q.items[1]?.answer,
    box: richDocToPlainText(boxOf(lesson).doc ?? { type: "doc" }),
  };
};

const openDrawer = () =>
  fireEvent.click(within(toolbar("Slide")).getByRole("button", { name: "Answer" }));

describe("AnswerDrawer on a coded set", () => {
  test("row 3: changing answer 2 changes the revealed answers and the question; one Undo restores both", async () => {
    const { read } = renderEditor(withSet());
    openDrawer();
    expect(await screen.findAllByRole("textbox", { name: /^Answer to question/ })).toHaveLength(3);
    const second = screen.getByRole("textbox", { name: "Answer to question 2" });
    expect(second).toHaveValue("Boudica");
    fireEvent.change(second, { target: { value: "Queen " } });
    // The space being typed stays in the field; the box holds the answer trimmed.
    expect(second).toHaveValue("Queen ");
    fireEvent.change(second, { target: { value: "Queen Boudica" } });
    fireEvent.blur(second);
    expect(state(read())).toEqual({
      item: "Queen Boudica",
      box: "1 AD 43\n2 Queen Boudica\n3 Hadrian",
    });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(state(read())).toEqual({ item: "Boudica", box: "1 AD 43\n2 Boudica\n3 Hadrian" });
  });

  test("the box is the source of truth: an edit made on the canvas shows in the drawer, and a drawer edit keeps the teacher's other lines", async () => {
    const slide = codedSetSlide();
    const box = slide.elements.find((e) => e.id === "set-answers") as ShapeElement;
    // As if typed on the canvas: answer 1 changed, a note added; the question's copy is stale.
    const typed = withSetAnswer(box.doc ?? { type: "doc" }, 0, "AD 43 (Claudius)");
    box.doc = {
      ...typed,
      content: [
        ...(typed.content ?? []),
        {
          type: "paragraph",
          content: [
            { type: "text", text: "4 Ask who built the wall", marks: [{ type: "italic" }] },
          ],
        },
      ],
    };
    const { read } = renderEditor(withSet(slide));
    openDrawer();
    const fields = await screen.findAllByRole("textbox", { name: /^Answer to question/ });
    expect(fields.map((f) => (f as HTMLTextAreaElement).value)).toEqual([
      "AD 43 (Claudius)",
      "Boudica",
      "Hadrian",
      "Ask who built the wall",
    ]);
    fireEvent.change(fields[1] as HTMLElement, { target: { value: "Queen Boudica" } });
    const doc = boxOf(read()).doc;
    expect(richDocToPlainText(doc ?? { type: "doc" })).toBe(
      "1 AD 43 (Claudius)\n2 Queen Boudica\n3 Hadrian\n4 Ask who built the wall",
    );
    expect(doc?.content?.[3]?.content?.[0]?.marks).toEqual([{ type: "italic" }]);
  });

  test("row 5: a set slide stored without the question has no Answer drawer", () => {
    renderEditor(withSet(codedSetSlide(undefined, { question: false })));
    expect(within(toolbar("Slide")).queryByRole("button", { name: "Answer" })).toBeNull();
  });
});
