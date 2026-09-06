import { describe, expect, test } from "bun:test";
import { docFromBullets, docFromText } from "../model/factories";
import { docToPlainText, isDocEmpty, renderDocHTML } from "./static";

describe("static text rendering", () => {
  test("renders a paragraph doc to HTML without an editor", () => {
    expect(renderDocHTML(docFromText("Hello"))).toBe("<p>Hello</p>");
  });

  test("renders a bullet list and a link with the shared extensions", () => {
    expect(renderDocHTML(docFromBullets(["a", "b"]))).toBe(
      "<ul><li><p>a</p></li><li><p>b</p></li></ul>",
    );
    const linked = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "BBC",
              marks: [{ type: "link", attrs: { href: "https://bbc.co.uk" } }],
            },
          ],
        },
      ],
    };
    expect(renderDocHTML(linked)).toContain('href="https://bbc.co.uk"');
    expect(renderDocHTML(linked)).toContain('target="_blank"');
    expect(renderDocHTML(linked)).toContain('rel="noopener noreferrer"');
  });

  test("caches per doc identity", () => {
    const doc = docFromText("Once");
    expect(renderDocHTML(doc)).toBe(renderDocHTML(doc));
  });

  test("falls back to escaped plain text when the doc is not renderable", () => {
    const broken = {
      type: "doc" as const,
      content: [{ type: "nope<b>", content: [{ type: "text", text: "<x>" }] }],
    };
    expect(renderDocHTML(broken)).toBe("<p>&lt;x&gt;</p>");
  });

  test("docToPlainText joins paragraphs and list items with newlines", () => {
    // A list item closes its paragraph and then itself, so items are a blank line apart.
    expect(docToPlainText(docFromBullets(["a", "b"]))).toBe("a\n\nb");
    expect(docToPlainText(docFromText("one\ntwo"))).toBe("one\ntwo");
  });

  test("isDocEmpty ignores whitespace and missing docs", () => {
    expect(isDocEmpty(undefined)).toBe(true);
    expect(isDocEmpty(docFromText("   "))).toBe(true);
    expect(isDocEmpty(docFromText("x"))).toBe(false);
  });
});
