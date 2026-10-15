import { describe, expect, test } from "bun:test";
import type { LayoutRef, TextElement } from "@tj/domain/documents";
import { addItem, editItem, relayout, removeItem } from "../relayout";
import { resolveTextStyle } from "../text-style";
import { atKeyStage, getTheme } from "../themes";
import { EXIT_MAX } from "./exit-ticket";
import type { Stage } from "./index";
import { PRACTICE_MAX, PRACTICE_MIN, WA_NAMES } from "./practice";

/*
 * TEACH-230 part b, common acceptance row 7: practice and the exit ticket re-lay in the editor
 * (TEACH-205 part b). Add and remove stay within min..max, a blank task keeps its siblings' look,
 * an edit lands on its task, and every stored font size is what the renderer draws at the stage.
 */
const theme = getTheme("paper");
const STAGES: Stage[] = ["ks1", "ks2", "ks3"];
const practice = (n: number): LayoutRef => ({
  template: "practice",
  input: {
    heading: "Sums",
    questions: Array.from({ length: n }, (_, i) => `${i + 10} + ${i + 20} =`),
  },
});
const exit = (n: number): LayoutRef => ({
  template: "exit-ticket",
  input: { heading: "Before you go", questions: Array.from({ length: n }, (_, i) => `Name ${i}.`) },
});
const tasks = (ref: LayoutRef, stage: Stage) =>
  relayout(ref, theme, stage).elements.filter((e) => e.name === WA_NAMES.task) as TextElement[];

describe("practice and exit ticket re-lay in the editor", () => {
  test("add stops at the max, remove at the min", () => {
    for (const stage of STAGES) {
      expect(addItem(practice(PRACTICE_MAX), 0, stage).ok).toBe(false);
      expect(removeItem(practice(PRACTICE_MIN), 0).ok).toBe(false);
      expect(addItem(exit(EXIT_MAX), 0, stage).ok).toBe(false);
      expect(removeItem(exit(1), 0).ok).toBe(false);
      const added = addItem(practice(3), 3, stage);
      expect(added.ok).toBe(true);
      if (added.ok) expect(tasks(added.ref, stage)).toHaveLength(4);
    }
  });

  test("a blank task keeps its siblings' size", () => {
    const added = addItem(practice(3), 1, "ks2");
    if (!added.ok) throw new Error("add refused");
    const sizes = new Set(tasks(added.ref, "ks2").map((t) => t.style.fontSize));
    expect(sizes.size).toBe(1);
  });

  test("an edit lands on its own task", () => {
    const next = editItem(exit(2), "questions.1", "Where does a plant take in water?");
    const ts = tasks(next, "ks2");
    expect(JSON.stringify(ts[1]?.doc)).toContain("take in water");
    expect(JSON.stringify(ts[0]?.doc)).toContain("Name 0.");
  });

  test("every stored font size is the size the renderer draws at the stage", () => {
    for (const stage of STAGES)
      for (const ref of [practice(4), exit(3)])
        for (const el of relayout(ref, theme, stage).elements)
          if (el.type === "text")
            expect(
              resolveTextStyle(el.style, atKeyStage(theme, stage), el.style.preset).fontSize,
            ).toBe(el.style.fontSize as number);
  });
});
