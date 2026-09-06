import { describe, expect, test } from "bun:test";
import type { RichDoc } from "@tj/domain/documents";
import { normaliseDoc } from "./normalise";

describe("normaliseDoc", () => {
  test("returns the same object for a doc ProseMirror already accepts", () => {
    const doc: RichDoc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
    };
    expect(normaliseDoc(doc)).toBe(doc);
    const empty: RichDoc = { type: "doc", content: [{ type: "paragraph" }] };
    expect(normaliseDoc(empty)).toBe(empty);
  });

  test("strips empty text runs and keeps the words around them, marks intact", () => {
    const doc: RichDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "" },
            { type: "text", text: "Hello", marks: [{ type: "bold" }] },
            { type: "text", text: "" },
          ],
        },
      ],
    };
    expect(normaliseDoc(doc)).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello", marks: [{ type: "bold" }] }],
        },
      ],
    });
  });

  test("a paragraph left with nothing becomes an empty paragraph, not a paragraph with []", () => {
    const doc: RichDoc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }],
    };
    expect(normaliseDoc(doc)).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  test("a doc left with nothing becomes the canonical empty doc", () => {
    expect(normaliseDoc({ type: "doc", content: [{ type: "text", text: "" }] })).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  test("reaches into lists", () => {
    const doc: RichDoc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "" },
                    { type: "text", text: "One" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const out = normaliseDoc(doc);
    expect(out.content?.[0]?.content?.[0]?.content?.[0]?.content).toEqual([
      { type: "text", text: "One" },
    ]);
  });

  test("never mutates its input", () => {
    const doc: RichDoc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }],
    };
    const before = JSON.stringify(doc);
    normaliseDoc(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });
});
