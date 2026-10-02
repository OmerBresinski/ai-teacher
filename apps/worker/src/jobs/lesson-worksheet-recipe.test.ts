import { describe, expect, test } from "bun:test";
import { DEMO_LESSON_FACTS } from "@tj/slides";
import { chooseRecipe, waitWhileLessonGenerates } from "./lesson-worksheet";

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

describe("Follows the lesson waits for the slides (eval, 2 Oct)", () => {
  const noSleep = async () => {};

  test("waits while the lesson is generating, then goes on", async () => {
    const states = [true, true, true, false];
    const result = await waitWhileLessonGenerates(
      async () => states.shift() ?? false,
      new AbortController().signal,
      { pollMs: 2000, sleep: noSleep },
    );
    expect(result).toEqual({ waitedMs: 6000, finished: true });
  });

  test("no wait when the slides are already written", async () => {
    const result = await waitWhileLessonGenerates(async () => false, new AbortController().signal, {
      sleep: noSleep,
    });
    expect(result).toEqual({ waitedMs: 0, finished: true });
  });

  test("gives up at the timeout, and on abort, so the outline is used", async () => {
    const timedOut = await waitWhileLessonGenerates(
      async () => true,
      new AbortController().signal,
      {
        timeoutMs: 4000,
        pollMs: 2000,
        sleep: noSleep,
      },
    );
    expect(timedOut).toEqual({ waitedMs: 4000, finished: false });
    const abort = new AbortController();
    abort.abort();
    const aborted = await waitWhileLessonGenerates(async () => true, abort.signal, {
      sleep: noSleep,
    });
    expect(aborted).toEqual({ waitedMs: 0, finished: false });
  });
});
