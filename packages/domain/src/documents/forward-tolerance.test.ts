import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkLesson } from "./checks";
import { GenerationSchema } from "./generation";
import { parseLesson } from "./lesson";
import { LessonFactsSchema } from "./lesson-facts";
import { summarise } from "./summarise";
import { parseStoredWorksheet, parseWorksheet } from "./worksheet";

/*
 * Rollback tolerance (release 11 Nov). Documents exactly as the next release saves them (taken
 * from its e2e run, `scratchpad/tuning/e2e-11nov/out/round3`, with the job's `generation` record
 * added as its worker writes it) must load, save and reload under this build without losing what
 * the newer build added: lessons carry `facts.buildsOn`, `facts.points` and
 * `generation.shipGate`; sheets carry the new recipe ids, `stage: "failed"` and
 * `generation.failure`. If the release is reverted, teachers' saved lessons stay readable.
 */

const dir = join(import.meta.dir, "fixtures", "forward-11nov");
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
/** A save by this build: parse, store the parse, read it back (`putDocument` stores the parse). */
const stored = <T>(parse: (input: unknown) => T, input: unknown): T =>
  parse(JSON.parse(JSON.stringify(parse(input))));

describe("a lesson saved by the next release", () => {
  const input = fixture("lesson-y8-photosynthesis") as {
    title: string;
    facts: Record<string, unknown>;
    generation: Record<string, unknown>;
  };

  test("carries the new keys this build must keep", () => {
    expect(input.facts.points).toBeArray();
    expect(typeof input.facts.buildsOn).toBe("string");
    expect(input.generation.shipGate).toBeObject();
  });

  test("parses, and a save keeps every key it carried", () => {
    expect(stored(parseLesson, input)).toEqual(parseLesson(input));
    const after = stored(parseLesson, input) as unknown as typeof input;
    expect(after.facts.points).toEqual(input.facts.points);
    expect(after.facts.buildsOn).toBe(input.facts.buildsOn);
    expect(after.generation.shipGate).toEqual(input.generation.shipGate);
  });

  test("an edit by this build (title) keeps the new keys", () => {
    const edited = { ...parseLesson(input), title: "Photosynthesis, edited" };
    const after = stored(parseLesson, edited) as unknown as typeof input;
    expect(after.title).toBe("Photosynthesis, edited");
    expect(after.facts.points).toEqual(input.facts.points);
    expect(after.generation.shipGate).toEqual(input.generation.shipGate);
  });

  test("lists and checks without throwing", () => {
    const lesson = parseLesson(input);
    expect(summarise(lesson).kind).toBe("lesson");
    expect(() => checkLesson(lesson)).not.toThrow();
  });

  test("keys this build reads are still checked as before", () => {
    const facts = parseLesson(input).facts;
    expect(LessonFactsSchema.safeParse({ ...facts, durationMin: 2.5 }).success).toBe(false);
    const generation = parseLesson(input).generation;
    expect(GenerationSchema.safeParse({ ...generation, stage: "done" }).success).toBe(false);
  });
});

describe("worksheets saved by the next release", () => {
  for (const name of ["practice-y5-fractions", "exit-y5-fractions", "failed-y5-fractions"]) {
    test(`${name} parses, saves without loss, and lists`, () => {
      const input = fixture(name);
      const sheet = parseWorksheet(input);
      expect(stored(parseWorksheet, input)).toEqual(sheet);
      expect(parseStoredWorksheet(input)).toEqual(sheet);
      expect(sheet.generation).toEqual((input as { generation: never }).generation);
      expect(summarise(sheet).kind).toBe("worksheet");
    });
  }

  test("a failed sheet keeps its failure and stage through an edit by this build", () => {
    const input = fixture("failed-y5-fractions") as { generation: Record<string, unknown> };
    const after = stored(parseWorksheet, { ...parseWorksheet(input), title: "Renamed" });
    expect(after.title).toBe("Renamed");
    expect(after.generation?.stage).toBe("failed");
    expect(after.generation?.recipeId).toBe("quick-quiz");
    expect((after.generation as Record<string, unknown> | undefined)?.failure).toEqual(
      input.generation.failure,
    );
  });

  test("still refuses stages and recipe ids no build writes", () => {
    const input = fixture("failed-y5-fractions") as { generation: Record<string, unknown> };
    const withGeneration = (patch: Record<string, unknown>) => ({
      ...input,
      generation: { ...input.generation, ...patch },
    });
    expect(() => parseWorksheet(withGeneration({ stage: "planned" }))).toThrow();
    expect(() => parseWorksheet(withGeneration({ recipeId: "retrieval-grid" }))).toThrow();
    expect(() => parseWorksheet(withGeneration({ practiceMinutes: 0 }))).toThrow();
  });
});
