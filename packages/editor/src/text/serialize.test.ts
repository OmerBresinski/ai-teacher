import { describe, expect, test } from "bun:test";
import { generateHTML } from "@tiptap/html";
import type { RichDoc } from "@tj/domain/documents";
import { docFromBullets, docFromText } from "../model/factories";
import { baseExtensions } from "./extensions";
import { serializeDoc, UnknownRichNodeError } from "./serialize";

/** Tiptap's own output over the shared extension set — the reference the serialiser must match. */
const tiptap = (doc: RichDoc) =>
  generateHTML(doc as Parameters<typeof generateHTML>[0], baseExtensions);

const p = (content: RichDoc["content"], attrs?: Record<string, unknown>) => ({
  type: "paragraph",
  ...(attrs ? { attrs } : {}),
  content,
});
const t = (text: string, marks?: { type: string; attrs?: Record<string, unknown> }[]) => ({
  type: "text",
  text,
  ...(marks ? { marks } : {}),
});

const FIXTURES: Record<string, RichDoc> = {
  plain: docFromText("Hello"),
  twoParagraphs: docFromText("one\ntwo"),
  emptyParagraph: { type: "doc", content: [p(undefined)] },
  bullets: docFromBullets(["a", "b"]),
  marks: {
    type: "doc",
    content: [
      p([
        t("Bold", [{ type: "bold" }]),
        t(" it ", [{ type: "italic" }, { type: "underline" }]),
        t("s", [{ type: "strike" }]),
        t("c", [{ type: "code" }]),
        t("all", [{ type: "bold" }, { type: "italic" }, { type: "underline" }, { type: "strike" }]),
      ]),
    ],
  },
  marksOutOfOrder: {
    type: "doc",
    content: [p([t("x", [{ type: "underline" }, { type: "bold" }, { type: "italic" }])])],
  },
  colour: {
    type: "doc",
    content: [
      p([
        t("red", [{ type: "textStyle", attrs: { color: "#f00" } }]),
        t("plain", [{ type: "textStyle", attrs: {} }]),
      ]),
    ],
  },
  link: {
    type: "doc",
    content: [
      p([
        t('x<y & "z"', [
          {
            type: "link",
            attrs: { href: "https://a.b/?q=1&r=2", target: "_blank", rel: "noopener noreferrer" },
          },
        ]),
        t("bold link", [
          { type: "bold" },
          {
            type: "link",
            attrs: {
              href: "https://c.d",
              target: "_blank",
              rel: "noopener noreferrer",
              class: null,
            },
          },
        ]),
      ]),
    ],
  },
  align: {
    type: "doc",
    content: [
      p([t("c")], { textAlign: "center" }),
      p([t("r")], { textAlign: "right" }),
      p([t("l")], { textAlign: "left" }),
    ],
  },
  hardBreak: { type: "doc", content: [p([t("a"), { type: "hardBreak" }, t("b")])] },
  ordered: {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { start: 3 },
        content: [{ type: "listItem", content: [p([t("one")])] }],
      },
      {
        type: "orderedList",
        attrs: { start: 1 },
        content: [{ type: "listItem", content: [p([t("two")])] }],
      },
      { type: "orderedList", content: [{ type: "listItem", content: [p([t("three")])] }] },
    ],
  },
  nestedList: {
    type: "doc",
    content: [
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              p([t("outer")]),
              { type: "bulletList", content: [{ type: "listItem", content: [p([t("inner")])] }] },
            ],
          },
        ],
      },
    ],
  },
  escaping: docFromText("<script>alert('x') & y > z</script>"),
  emptyDoc: { type: "doc" },
};

describe("serializeDoc matches @tiptap/html byte for byte", () => {
  for (const [name, doc] of Object.entries(FIXTURES)) {
    test(name, () => {
      expect(serializeDoc(doc)).toBe(tiptap(doc));
    });
  }

  test("an unknown node type throws so renderDocHTML can fall back", () => {
    expect(() =>
      serializeDoc({ type: "doc", content: [{ type: "heading", content: [t("h")] }] }),
    ).toThrow(UnknownRichNodeError);
    expect(() =>
      serializeDoc({ type: "doc", content: [p([t("x", [{ type: "highlight" }])])] }),
    ).toThrow(UnknownRichNodeError);
  });
});
