import type { Lesson, RichDoc, TextElement } from "@tj/domain/documents";
import { generatedLesson } from "@tj/domain/documents/fixtures";

/* Shared by the objectives-slide tests (ruling 96). */

export type Line = { text: string; id?: string | null };

/** The objectives slide's numbered body as the editor holds it. */
export function objectivesDoc(lines: Line[]): RichDoc {
  return {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { start: 1 },
        content: lines.map((l) => ({
          type: "listItem",
          attrs: { factId: l.id ?? null },
          content: [
            { type: "paragraph", content: l.text ? [{ type: "text", text: l.text }] : undefined },
          ],
        })),
      },
    ],
  };
}

/** `generatedLesson()` with its objectives slide laid out as one stamped numbered list. */
export function listLesson(lines?: Line[]): Lesson {
  const lesson = generatedLesson();
  const slide = lesson.slides.find((s) => s.id === "s-objectives");
  if (!slide) throw new Error("fixture");
  const heading = slide.elements[0];
  const body: TextElement = {
    id: "ob-list",
    type: "text",
    x: 60,
    y: 140,
    w: 840,
    h: 200,
    doc: objectivesDoc(
      lines ?? [
        { text: "describe the stages of the water cycle", id: "o1" },
        { text: "explain how evaporation and condensation are linked", id: "o2" },
      ],
    ),
    style: { preset: "body" },
    authoredBy: "ai",
    generatedFrom: {
      factRefs: ["o1", "o2"],
      promptVersion: "plan.v1",
      model: "m",
      at: "2026-09-06T10:00:00.000Z",
    },
  };
  slide.elements = heading ? [heading, body] : [body];
  return lesson;
}
