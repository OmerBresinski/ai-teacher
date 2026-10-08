import { describe, expect, test } from "bun:test";
import type { Lesson } from "@tj/domain/documents";
import {
  OBJECTIVES_FIRST_VERSION,
  plannerFor,
  plannerOf,
  resumeFromWriter,
  WRITER_PLANNED_VERSION,
} from "../stages/objectives-first";
import { slideRange } from "../stages/write";
import { WRITER_VERSION, writerRoute } from "./ai-services";

/* The writer planner's routing (TEACH-110 part b, row 9): the stamp wins over the flag. */

const lesson = (planned?: string, stage?: string, objectives = 2) =>
  ({
    id: "l1",
    ...(planned ? { generation: { stage: stage ?? "planned", promptVersions: { planned } } } : {}),
    facts: {
      objectives: Array.from({ length: objectives }, (_, k) => ({ id: `o${k}`, text: "x" })),
    },
  }) as unknown as Lesson;

describe("writer planner", () => {
  test("the writer stamp starts with the writer's version and is read as the writer", () => {
    expect(WRITER_PLANNED_VERSION.startsWith(`${WRITER_VERSION}+`)).toBe(true);
    expect(plannerOf(lesson(WRITER_PLANNED_VERSION))).toBe("writer");
    expect(plannerOf(lesson(OBJECTIVES_FIRST_VERSION))).toBe("objectives-first");
  });
  test("a new lesson takes the flag; a stamped one keeps its planner after a flip", () => {
    expect(plannerFor(lesson(), "writer")).toBe("writer");
    expect(plannerFor(lesson(WRITER_PLANNED_VERSION), "objectives-first")).toBe("writer");
    expect(plannerFor(lesson(WRITER_PLANNED_VERSION), undefined)).toBe("writer");
    expect(plannerFor(lesson(OBJECTIVES_FIRST_VERSION), "writer")).toBe("objectives-first");
  });
  test("a planned writer lesson resumes at the writer, never through the legacy order", () => {
    expect(resumeFromWriter(lesson(WRITER_PLANNED_VERSION))).toBe("write");
    expect(resumeFromWriter(lesson(WRITER_PLANNED_VERSION, "planned", 0))).toBe("check-input");
    expect(resumeFromWriter(lesson(WRITER_PLANNED_VERSION, "generated"))).toBeNull();
    expect(resumeFromWriter(lesson())).toBe("check-input");
  });
  test("the writer call is routed to Sol, the stage's small calls to Luna, nothing else", () => {
    const ctx = (stage: string, promptVersion: string) => ({ stage, promptVersion });
    expect(writerRoute("frontier", ctx("write", `${WRITER_VERSION}/lesson`))).toBe(
      "openai/gpt-6.1-sol",
    );
    expect(writerRoute("small", ctx("write-small", `${WRITER_VERSION}/slide`))).toBe(
      "openai/gpt-6-luna",
    );
    expect(writerRoute("frontier", ctx("generate", "generate-slide.v9"))).toBeUndefined();
    expect(writerRoute("frontier", undefined)).toBeUndefined();
  });
  test("slide ranges by tier (ruling 164)", () => {
    expect(slideRange(6)).toEqual({ min: 6, max: 8 });
    expect(slideRange(8)).toEqual({ min: 6, max: 8 });
    expect(slideRange(10)).toEqual({ min: 9, max: 12 });
    expect(slideRange(undefined)).toEqual({ min: 9, max: 12 });
  });
});
