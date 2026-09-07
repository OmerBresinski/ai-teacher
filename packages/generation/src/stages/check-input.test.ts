import { describe, expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import type { Finding, Lesson } from "@tj/domain/documents";
import { PROMPT_VERSIONS } from "../prompts";
import {
  initialState,
  recordingDeps,
  SAMPLE_WORKSHEET_ID,
  sampleBriefLesson,
  scriptedPipelineAi,
} from "../testing";
import { INPUT_CHECK_MESSAGES, InputRejected } from "../types";
import { resumeFrom, runLessonPipeline } from "../workflow";
import { checkInput } from "./check-input";

const json = (v: unknown) => JSON.stringify(v);
const usage = { inputTokens: 300, outputTokens: 20 };

const LEARNER_NAME: { findings: Finding[] } = {
  findings: [
    {
      check: "learner-name",
      severity: "error",
      target: {},
      message: "The brief seems to name a pupil. Please describe the class without naming anyone.",
    },
  ],
};

describe("check-input", () => {
  test("a learner-name finding rejects the run before anything is persisted or planned", async () => {
    const ai = scriptedPipelineAi({ checkInput: LEARNER_NAME });
    const deps = recordingDeps(ai);
    const error = await runLessonPipeline(
      { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
      deps,
    ).catch((e) => e);
    expect(error).toBeInstanceOf(InputRejected);
    expect((error as InputRejected).findings).toEqual(LEARNER_NAME.findings);
    // The message the worker and the job event carry is the fixed text, never the model's.
    expect((error as InputRejected).message).toBe(INPUT_CHECK_MESSAGES["learner-name"]);
    expect((error as InputRejected).message).not.toBe(LEARNER_NAME.findings[0]?.message);
    expect(deps.persisted).toHaveLength(0);
    expect(deps.progress).toHaveLength(0);
    expect(ai.calls.map((c) => c.context?.stage)).toEqual(["check-input"]);
  });

  test("a clean brief goes on to Plan: one extra small call, first in the sequence", async () => {
    const ai = scriptedPipelineAi();
    const deps = recordingDeps(ai);
    const { lesson } = await runLessonPipeline(
      { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
      deps,
    );
    // 1 check-input + 2 plan + 8 slides + 1 worksheet + 1 evaluate
    expect(ai.calls).toHaveLength(1 + 2 + 8 + 1 + 1);
    expect(ai.calls[0]).toMatchObject({
      modelClass: "small",
      context: { stage: "check-input", promptVersion: PROMPT_VERSIONS["check-input"] },
    });
    expect(ai.calls[1]?.context?.stage).toBe("plan");
    expect(lesson.generation?.stage).toBe("repaired");
  });

  test("a lesson resumed at `generated` skips the input check: no call", async () => {
    const first = recordingDeps(scriptedPipelineAi());
    await runLessonPipeline(
      { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
      first,
    );
    const generated = first.persisted.find((p) => p.lesson.generation?.stage === "generated");
    if (!generated) throw new Error("no generated checkpoint recorded");
    expect(resumeFrom(generated.lesson)).toBe("evaluate");

    const ai = createFakeAi({ script: [json({ findings: [] })], usage });
    await runLessonPipeline(
      {
        lesson: generated.lesson,
        worksheet: generated.worksheet,
        worksheetId: SAMPLE_WORKSHEET_ID,
      },
      recordingDeps(ai),
    );
    expect(ai.calls.map((c) => c.context?.stage)).toEqual(["evaluate"]);
  });

  test("the Identifier guard's structural hit rejects without a model call", async () => {
    // `parseLesson` would refuse this brief (the guard is a schema refinement), so the belt and
    // braces case has to be built past the parser: a row written before the guard existed.
    const lesson: Lesson = {
      ...sampleBriefLesson(),
      brief: { topic: "Fractions", durationMin: 60, classContext: { notes: "UPN 1234567890" } },
    };
    const ai = createFakeAi({ script: [], usage });
    const error = await checkInput(initialState(lesson), recordingDeps(ai)).catch((e) => e);
    expect(error).toBeInstanceOf(InputRejected);
    expect((error as InputRejected).findings.map((f) => f.check)).toEqual(["learner-name"]);
    expect(ai.calls).toHaveLength(0);
  });

  test("the model's answer is validated: an unknown check or a warning is a schema miss, retried once", async () => {
    const warning = {
      findings: [{ check: "learner-name", severity: "warning", target: {}, message: "Hm." }],
    };
    const ai = createFakeAi({ script: [json(warning), json({ findings: [] })], usage });
    const state = await checkInput(initialState(), recordingDeps(ai));
    expect(ai.calls).toHaveLength(2);
    expect(state.lesson.slides).toEqual([]);
  });

  test("never logs the brief: the one log line carries the stage and a count", async () => {
    const lines: string[] = [];
    const { default: pino } = await import("pino");
    const logger = pino({ level: "info" }, { write: (l: string) => void lines.push(l) });
    const lesson = sampleBriefLesson({
      brief: { topic: "Help Amir with fractions", durationMin: 60 },
    });
    const ai = createFakeAi({ script: [json(LEARNER_NAME)], usage });
    await checkInput(initialState(lesson), recordingDeps(ai, { logger })).catch(() => undefined);
    const line = lines.map((l) => JSON.parse(l)).find((r) => r.msg === "input checked");
    expect(line).toMatchObject({ stage: "check-input", findings: 1 });
    expect(lines.join("\n")).not.toContain("Amir");
  });
});
