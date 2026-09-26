import { describe, expect, test } from "bun:test";
import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { type Lesson, objectiveListLines, type TextElement } from "@tj/domain/documents";
import { generatedLesson } from "@tj/domain/documents/fixtures";
import type { ReactNode } from "react";
import { useDocumentHistory } from "../use-document-history";
import {
  ignoreCheck,
  objectiveLineIds,
  updateFact,
  writeElementDoc,
  writeObjectiveLines,
} from "./index";
import { type Line, listLesson, objectivesDoc } from "./objective-lines.test-helpers";

/*
 * Ruling 96: the objectives slide is the objective editor. A write of its list writes the
 * objectives in the same reducer; removing a line waits for E3 and leaves the objective alone.
 */

notifyManager.setScheduler((callback) => callback());

const write = (lesson: Lesson, lines: Line[], reserved: readonly string[] | null = []) =>
  writeElementDoc(lesson, "s-objectives", "ob-list", objectivesDoc(lines), reserved);

const texts = (lesson: Lesson) => lesson.facts?.objectives.map((o) => [o.id, o.text]);
const lineIds = (lesson: Lesson) => {
  const el = lesson.slides
    .find((s) => s.id === "s-objectives")
    ?.elements.find((e) => e.id === "ob-list");
  return el?.type === "text" ? objectiveListLines(el.doc)?.map((l) => l.factId) : undefined;
};

describe("writeObjectiveLines", () => {
  test("editing a line writes its objective, stored without the stem and capitalised back", () => {
    const next = write(listLesson(), [
      { text: "describe the water cycle in four stages", id: "o1" },
      { text: "explain how evaporation and condensation are linked", id: "o2" },
    ]);
    expect(texts(next)).toEqual([
      ["o1", "Describe the water cycle in four stages"],
      ["o2", "Explain how evaporation and condensation are linked"],
    ]);
  });

  test("a new line with words becomes a new objective and carries its id", () => {
    const next = write(listLesson(), [
      { text: "describe the stages of the water cycle", id: "o1" },
      { text: "explain how evaporation and condensation are linked", id: "o2" },
      { text: "predict where a puddle goes" },
    ]);
    expect(texts(next)?.[2]).toEqual(["o3", "Predict where a puddle goes"]);
    expect(lineIds(next)).toEqual(["o1", "o2", "o3"]);
  });

  test("a new id skips ids the worksheet uses; with the worksheet not loaded, nothing is added", () => {
    const lines = [
      { text: "describe the stages of the water cycle", id: "o1" },
      { text: "explain how evaporation and condensation are linked", id: "o2" },
      { text: "predict where a puddle goes" },
    ];
    expect(texts(write(listLesson(), lines, ["o3", "o4"]))?.[2]?.[0]).toBe("o5");
    const waiting = write(listLesson(), lines, null);
    expect(waiting.facts?.objectives).toHaveLength(2);
    expect(lineIds(waiting)).toEqual(["o1", "o2", null]);
  });

  test("an empty new line writes nothing and an emptied line keeps its objective's words", () => {
    const next = write(listLesson(), [
      { text: "", id: "o1" },
      { text: "explain how evaporation and condensation are linked", id: "o2" },
      { text: "" },
    ]);
    expect(texts(next)).toEqual(texts(listLesson()));
  });

  test("a fifth line is never an objective (ruling 64)", () => {
    const four = [
      { text: "describe the stages of the water cycle", id: "o1" },
      { text: "explain how evaporation and condensation are linked", id: "o2" },
      { text: "name three kinds of rain" },
      { text: "draw the cycle" },
    ];
    const atFour = write(listLesson(), four);
    expect(atFour.facts?.objectives.map((o) => o.id)).toEqual(["o1", "o2", "o3", "o4"]);
    const five = write(atFour, [
      { text: "describe the stages of the water cycle", id: "o1" },
      { text: "explain how evaporation and condensation are linked", id: "o2" },
      { text: "name three kinds of rain", id: "o3" },
      { text: "draw the cycle", id: "o4" },
      { text: "label a diagram" },
    ]);
    expect(five.facts?.objectives).toHaveLength(4);
    expect(lineIds(five)).toEqual(["o1", "o2", "o3", "o4", null]);
  });

  test("E3 pending: a removed line leaves its objective in the facts, as before", () => {
    const next = write(listLesson(), [
      { text: "describe the stages of the water cycle", id: "o1" },
    ]);
    expect(texts(next)).toEqual(texts(listLesson()));
  });

  test("a duplicated id counts once: the copy is a new line", () => {
    const next = write(listLesson(), [
      { text: "describe the stages of the water cycle", id: "o1" },
      { text: "explain how evaporation and condensation are linked", id: "o2" },
      { text: "explain it again", id: "o2" },
    ]);
    expect(lineIds(next)).toEqual(["o1", "o2", "o3"]);
    expect(next.facts?.objectives[1]?.text).toBe(
      "Explain how evaporation and condensation are linked",
    );
  });

  test("an older lesson without ids is matched by position, only when the counts agree", () => {
    const lesson = listLesson([
      { text: "describe the stages of the water cycle" },
      { text: "explain how evaporation and condensation are linked" },
    ]);
    const edited = write(lesson, [
      { text: "describe the water cycle" },
      { text: "explain how evaporation and condensation are linked" },
    ]);
    expect(edited.facts?.objectives[0]?.text).toBe("Describe the water cycle");
    expect(lineIds(edited)).toEqual(["o1", "o2"]);
    const mismatched = write(lesson, [{ text: "describe the water cycle" }]);
    expect(mismatched.facts).toBe(lesson.facts);
  });

  test("only the objectives slide writes through; the same words are a no-op", () => {
    const lesson = listLesson();
    expect(writeObjectiveLines(lesson, "s-objectives", "ob-list")).toBe(lesson);
    expect(writeObjectiveLines(lesson, "s-vocab", "v1-term")).toBe(lesson);
    expect(objectiveLineIds(lesson, "s-vocab", "v1-term")).toBeNull();
  });
});

describe("updateFact on an objective (the Facts panel)", () => {
  test("writes the objective's own stamped line, in the same step, and leaves the others", () => {
    const next = updateFact(listLesson(), "o2", { text: "Explain why evaporation needs heat" });
    expect(next.facts?.objectives[1]?.text).toBe("Explain why evaporation needs heat");
    const list = next.slides[1]?.elements.find((e) => e.id === "ob-list") as TextElement;
    expect(objectiveListLines(list.doc)?.map((l) => l.text)).toEqual([
      "describe the stages of the water cycle",
      "explain why evaporation needs heat",
    ]);
  });
});

describe("ignoreCheck", () => {
  test("records the check once per fact", () => {
    const once = ignoreCheck(generatedLesson(), "objective-taught", "o2");
    expect(once.ignoredChecks).toEqual([{ check: "objective-taught", factId: "o2" }]);
    expect(ignoreCheck(once, "objective-taught", "o2")).toBe(once);
  });
});

describe("one undo step (ruling 44)", () => {
  test("the slide edit and the objective edit are undone together", () => {
    const KEY = ["library", "documents", "L1"] as const;
    const client = new QueryClient();
    const seed = listLesson();
    client.setQueryData(KEY, seed);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(
      () => useDocumentHistory({ queryKey: KEY, queryFn: () => Promise.resolve(seed) }),
      { wrapper },
    );
    act(() => {
      hook.result.current.dispatch(
        writeElementDoc,
        "s-objectives",
        "ob-list",
        objectivesDoc([
          { text: "describe the water cycle", id: "o1" },
          { text: "explain how evaporation and condensation are linked", id: "o2" },
        ]),
        [],
      );
    });
    const lesson = () => hook.result.current.lesson as Lesson;
    expect(lesson().facts?.objectives[0]?.text).toBe("Describe the water cycle");
    act(() => hook.result.current.undo());
    expect(lesson().facts?.objectives[0]?.text).toBe("Describe the stages of the water cycle");
    const list = lesson().slides[1]?.elements.find((e) => e.id === "ob-list") as TextElement;
    expect(objectiveListLines(list.doc)?.[0]?.text).toBe("describe the stages of the water cycle");
  });
});
