import { describe, expect, test } from "bun:test";
import { richDocToPlainText } from "./rich-text";

describe("richDocToPlainText", () => {
  test("joins text nodes and separates paragraphs and list items with a line break", () => {
    expect(
      richDocToPlainText({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Hello, " },
              { type: "text", text: "world", marks: [{ type: "bold" }] },
            ],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }],
              },
              {
                type: "listItem",
                content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }],
              },
            ],
          },
        ],
      }),
    ).toBe("Hello, world\none\n\ntwo");
  });

  test("an empty doc or a doc of empty paragraphs is the empty string", () => {
    expect(richDocToPlainText({ type: "doc" })).toBe("");
    expect(richDocToPlainText({ type: "doc", content: [{ type: "paragraph" }] })).toBe("");
  });

  test("accepts a single node", () => {
    expect(richDocToPlainText({ type: "text", text: "gap [[gap:g1]] here" })).toBe(
      "gap [[gap:g1]] here",
    );
  });
});
