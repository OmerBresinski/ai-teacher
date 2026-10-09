import { describe, expect, test } from "bun:test";
import { labAi, romansLesson } from "../planner/testing";
import { initialState, recordingDeps } from "../testing";
import { InputRejected } from "../types";
import { WRITER_VERSION, writerRoute } from "../writer/ai-services";
import { checkedWriterObjectives } from "./objectives";

/*
 * C14 (TEACH-110 part h): the writer planner's input check runs beside its objectives call. Both
 * start at once; the plan is persisted only after the check passes, and a refusal drops the
 * objectives with nothing persisted.
 */

const OBJECTIVES = JSON.stringify({
  objectives: [
    "Describe who invaded Britain in AD 43.",
    "Explain why the Romans invaded Britain.",
    "Evaluate how far the invasion changed Britain.",
  ],
});

function run(checkAnswer: unknown, checkMs = 40) {
  const events: string[] = [];
  const ai = labAi({
    route: writerRoute,
    extra: (call) => {
      const v = call.context?.promptVersion ?? "";
      if (v.startsWith("check-input")) {
        events.push("check:start");
        return new Promise<string>((resolve) =>
          setTimeout(() => {
            events.push("check:end");
            resolve(JSON.stringify(checkAnswer));
          }, checkMs),
        ) as never;
      }
      if (v === `${WRITER_VERSION}/objectives`) {
        events.push("objectives:start");
        events.push("objectives:end");
        return OBJECTIVES;
      }
      return undefined;
    },
  });
  const deps = recordingDeps(ai);
  return { events, deps, done: checkedWriterObjectives(initialState(romansLesson()), deps) };
}

describe("check-input beside the writer's objectives (C14)", () => {
  test("both calls start before either ends; the plan is persisted after the check", async () => {
    const { events, deps, done } = run({ findings: [] });
    const state = await done;
    expect(events.slice(0, 2).sort()).toEqual(["check:start", "objectives:start"]);
    expect(events.indexOf("objectives:end")).toBeLessThan(events.indexOf("check:end"));
    expect(deps.persisted).toHaveLength(1);
    expect(state.lesson.generation?.stage).toBe("planned");
    expect(state.lesson.facts?.objectives).toHaveLength(3);
  });

  test("a refusal drops the objectives and persists nothing", async () => {
    const { events, deps, done } = run({
      findings: [{ check: "not-a-lesson", severity: "error", target: {}, message: "x" }],
    });
    await expect(done).rejects.toBeInstanceOf(InputRejected);
    // The objectives call had already answered: its result is thrown away.
    expect(events).toContain("objectives:end");
    expect(deps.persisted).toHaveLength(0);
    expect(deps.progress.some((p) => p.message === "Planned")).toBe(false);
  });

  test("guarded text (a learner identifier) reaches no model: neither call starts", async () => {
    const calls: string[] = [];
    const ai = labAi({
      route: writerRoute,
      extra: (call) => {
        calls.push(call.context?.promptVersion ?? "");
        return undefined;
      },
    });
    const deps = recordingDeps(ai);
    const lesson = romansLesson();
    const named = {
      ...lesson,
      brief: { ...lesson.brief, topic: "Romans for jo.bloggs@school.org" },
    } as typeof lesson;
    await expect(checkedWriterObjectives(initialState(named), deps)).rejects.toBeInstanceOf(
      InputRejected,
    );
    expect(calls).toEqual([]);
    expect(ai.calls).toHaveLength(0);
    expect(deps.persisted).toHaveLength(0);
  });
});
