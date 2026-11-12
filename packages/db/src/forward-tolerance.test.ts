import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Lesson, Worksheet } from "@tj/domain/documents";
import { keepWritingSlides } from "@tj/domain/documents";
import { parseDocumentBody, promotedColumns } from "./documents";

/*
 * Rollback tolerance (release 11 Nov), at the storage seam: every save (`putDocument`,
 * `putDocumentAsJob`, `createDocument`) and every reload runs `parseDocumentBody`, and the stored
 * body is what it returns. Documents exactly as the next release saves them must pass it with
 * every key intact, so a revert leaves them savable and the newer build reads back what it wrote.
 * No database: these are the pure functions the queries call.
 */

const dir = join(import.meta.dir, "../../domain/src/documents/fixtures/forward-11nov");
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
/** Save then reload: the row stores the parse, JSON-encoded. */
const saved = (kind: "lesson" | "worksheet", input: unknown) =>
  parseDocumentBody(kind, JSON.parse(JSON.stringify(parseDocumentBody(kind, input))));

describe("parseDocumentBody on documents the next release saved", () => {
  test("a lesson with facts.points, facts.buildsOn and generation.shipGate", () => {
    const input = fixture("lesson-y8-photosynthesis") as Lesson;
    const after = saved("lesson", input) as Lesson;
    expect(after.facts).toEqual(input.facts);
    expect(after.generation).toEqual(input.generation);
    expect(promotedColumns(after).title).toBe(input.title);
  });

  test("a teacher save while the job holds the lesson keeps the job's generation as stored", () => {
    const input = parseDocumentBody("lesson", fixture("lesson-y8-photosynthesis")) as Lesson;
    const merged = keepWritingSlides(input, { ...input, title: "Edited" });
    expect(saved("lesson", merged)).toEqual({ ...input, title: "Edited" });
  });

  for (const name of ["practice-y5-fractions", "exit-y5-fractions", "failed-y5-fractions"]) {
    test(`worksheet ${name}`, () => {
      const input = fixture(name) as Worksheet;
      const after = saved("worksheet", input) as Worksheet;
      expect(after.generation).toEqual(input.generation);
      expect(after.blocks).toEqual(input.blocks);
      expect(promotedColumns(after).lessonId).toBe(input.lessonId ?? null);
    });
  }
});
