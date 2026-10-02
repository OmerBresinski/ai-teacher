import { describe, expect, test } from "bun:test";
import { DEMO_LESSON_FACTS } from "@tj/slides";
import { chooseRecipe } from "./lesson-worksheet";

/* TEACH-86 AC 7 at the job: the fallback and its log line, with no database. */

// The plan-write shape: no vocabulary saved with the facts.
const facts = { ...DEMO_LESSON_FACTS, vocabulary: [] };
const ids = { lessonId: "l-1", worksheetId: "w-1" };

function recorder() {
  const lines: { fields: Record<string, unknown>; msg: string }[] = [];
  return {
    lines,
    logger: { info: (fields: Record<string, unknown>, msg: string) => lines.push({ fields, msg }) },
  };
}

describe("chooseRecipe (lesson.worksheet)", () => {
  test("Cloze on a lesson with no vocabulary falls back to lesson and the job log says why", () => {
    const { lines, logger } = recorder();
    const { recipe, exitTicket } = chooseRecipe("cloze", facts, logger as never, ids);
    expect(recipe.id).toBe("lesson");
    expect(exitTicket).toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.msg).toBe(
      "worksheet recipe fell back to lesson: the facts would leave a block empty",
    );
    expect(lines[0]?.fields).toMatchObject({ ...ids, requested: "cloze" });
    expect(String(lines[0]?.fields.reasons)).toContain("word bank");
  });

  test("auto is lesson with no log line; asking for the exit ticket is a yes to one", () => {
    const auto = recorder();
    expect(chooseRecipe("auto", facts, auto.logger as never, ids).recipe.id).toBe("lesson");
    expect(auto.lines).toHaveLength(0);
    const exit = chooseRecipe("exit-ticket", facts, recorder().logger as never, ids);
    expect(exit.exitTicket).toBe(true);
  });
});
