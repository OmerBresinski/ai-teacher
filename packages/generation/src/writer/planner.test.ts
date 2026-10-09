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
  test("the teacher's slide count is exact, title and objectives included (ADR 0036)", () => {
    // Lesson 01a12146 asked for 10 and got 12: the tier 9–12 let the writer pick the top.
    for (const n of [6, 8, 10, 12]) expect(slideRange(n)).toEqual({ min: n, max: n });
    expect(slideRange(3)).toEqual({ min: 6, max: 6 });
    expect(slideRange(30)).toEqual({ min: 20, max: 20 });
    expect(slideRange(undefined)).toEqual({ min: 9, max: 12 });
  });
});

describe("the render binding's stamp prefix", () => {
  test("@tj/slides gates on the writer's own version", async () => {
    const { WRITER_STAMP_PREFIX } = await import("@tj/slides/themes");
    expect(WRITER_VERSION.startsWith(WRITER_STAMP_PREFIX)).toBe(true);
    expect(WRITER_PLANNED_VERSION.startsWith(WRITER_STAMP_PREFIX)).toBe(true);
  });
});

describe("the writer bundle travels with the lesson", () => {
  test("the planned stamp names the shipped bundle and a lesson resumes on its own", async () => {
    const { writerBundleOf } = await import("../stages/objectives-first");
    const { WRITER_BUNDLE_ID } = await import("./bundle");
    expect(WRITER_PLANNED_VERSION.endsWith(`+bundle-${WRITER_BUNDLE_ID}`)).toBe(true);
    expect(writerBundleOf(lesson(WRITER_PLANNED_VERSION))).toBe(WRITER_BUNDLE_ID);
    // An unknown bundle (removed since) falls back to the shipped one.
    expect(writerBundleOf(lesson(`${WRITER_VERSION}+x+bundle-gone`))).toBe(WRITER_BUNDLE_ID);
  });
});
