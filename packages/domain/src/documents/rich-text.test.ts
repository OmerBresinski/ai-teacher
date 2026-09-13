import { describe, expect, test } from "bun:test";
import {
  RICH_DOC_MAX_DEPTH,
  type RichDoc,
  RichDocSchema,
  type RichNode,
  richDocToPlainText,
  safeLinkHref,
} from "./rich-text";

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

/**
 * TEACH-277 (audit F01): the schema is closed. A link mark with `href: "javascript:…"` and
 * `target: "_self"` used to pass; POST /documents stored it and the viewer executed it on click.
 */
describe("RichDocSchema (closed schema, TEACH-277)", () => {
  const p = (content: RichNode[], attrs?: Record<string, unknown>): RichNode => ({
    type: "paragraph",
    ...(attrs ? { attrs } : {}),
    content,
  });
  const t = (text: string, marks?: RichNode["marks"]): RichNode => ({
    type: "text",
    text,
    ...(marks ? { marks } : {}),
  });
  const doc = (...content: RichNode[]): RichDoc => ({ type: "doc", content });
  const link = (attrs: Record<string, unknown>) => doc(p([t("x", [{ type: "link", attrs }])]));

  test("what Tiptap writes parses unchanged (incl. inert attrs it adds between versions)", () => {
    const tiptap = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "center" },
          content: [
            {
              type: "text",
              marks: [
                {
                  type: "link",
                  attrs: {
                    href: "https://x.y",
                    target: "_blank",
                    rel: "noopener noreferrer",
                    class: null,
                    title: "t",
                  },
                },
              ],
              text: "l",
            },
            { type: "text", text: " " },
            { type: "text", marks: [{ type: "textStyle", attrs: { color: "#f00" } }], text: "c" },
            { type: "text", marks: [{ type: "bold" }, { type: "italic" }], text: "b" },
            { type: "hardBreak" },
            { type: "text", marks: [{ type: "textStyle", attrs: {} }], text: "plain span" },
          ],
        },
        {
          type: "orderedList",
          attrs: { start: 3, type: null },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  attrs: { textAlign: null },
                  content: [{ type: "text", text: "a" }],
                },
                {
                  type: "bulletList",
                  content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
                },
              ],
            },
          ],
        },
        { type: "paragraph" },
      ],
    };
    expect(RichDocSchema.parse(tiptap)).toEqual(tiptap as unknown as RichDoc);
    expect(RichDocSchema.parse({ type: "doc" })).toEqual({ type: "doc" });
  });

  test.each([
    "javascript:void(document.body.dataset.auditXss=String(1))",
    "JavaScript:alert(1)",
    "java\tscript:alert(1)",
    "\u0000javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:x",
    "//evil.example",
    "/relative",
    "bbc.co.uk",
    "mailto:",
    "",
  ])("refuses a link href of %j", (href) => {
    expect(RichDocSchema.safeParse(link({ href, target: "_blank" })).success).toBe(false);
  });

  test("accepts http(s) and mailto links", () => {
    for (const href of ["https://a.b/?q=1&r=2", "http://a.b", "mailto:head@school.sch.uk"]) {
      expect(RichDocSchema.safeParse(link({ href })).success).toBe(true);
    }
  });

  test("refuses a link without an href, a non-_blank target and unknown rel tokens", () => {
    expect(RichDocSchema.safeParse(link({})).success).toBe(false);
    expect(RichDocSchema.safeParse(link({ href: "https://x.y", target: "_self" })).success).toBe(
      false,
    );
    expect(RichDocSchema.safeParse(link({ href: "https://x.y", target: "_top" })).success).toBe(
      false,
    );
    expect(RichDocSchema.safeParse(link({ href: "https://x.y", rel: "opener" })).success).toBe(
      false,
    );
    expect(RichDocSchema.safeParse(link({ href: "https://x.y", target: null })).success).toBe(true);
  });

  test("refuses CSS injection through colour and textAlign", () => {
    const colour = (color: unknown) => doc(p([t("c", [{ type: "textStyle", attrs: { color } }])]));
    expect(RichDocSchema.safeParse(colour("#ff0000")).success).toBe(true);
    expect(RichDocSchema.safeParse(colour("rgba(1,2,3,.5)")).success).toBe(true);
    expect(RichDocSchema.safeParse(colour("tomato")).success).toBe(true);
    expect(RichDocSchema.safeParse(colour(null)).success).toBe(true);
    expect(RichDocSchema.safeParse(colour("red; background: url(x)")).success).toBe(false);
    expect(RichDocSchema.safeParse(colour("expression(alert(1))")).success).toBe(false);
    expect(RichDocSchema.safeParse(doc(p([t("a")], { textAlign: "right" }))).success).toBe(true);
    expect(RichDocSchema.safeParse(doc(p([t("a")], { textAlign: "x; y" }))).success).toBe(false);
  });

  test("refuses unknown node and mark types and a text node without text", () => {
    expect(RichDocSchema.safeParse(doc({ type: "heading", content: [t("h")] })).success).toBe(
      false,
    );
    expect(RichDocSchema.safeParse(doc(p([{ type: "image", attrs: { src: "x" } }]))).success).toBe(
      false,
    );
    expect(RichDocSchema.safeParse(doc(p([t("x", [{ type: "highlight" }])]))).success).toBe(false);
    expect(RichDocSchema.safeParse(doc(p([{ type: "text" }]))).success).toBe(false);
    // A bare inline node where a block is expected is not a document either.
    expect(RichDocSchema.safeParse(doc(t("x"))).success).toBe(false);
  });

  test("refuses nesting deeper than RICH_DOC_MAX_DEPTH without recursing", () => {
    let node: RichNode = { type: "listItem", content: [p([t("deep")])] };
    for (let i = 0; i < 5_000; i += 1) {
      node = { type: "bulletList", content: [{ type: "listItem", content: [node] }] };
    }
    const result = RichDocSchema.safeParse({ type: "doc", content: [node] });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(`deeper than ${RICH_DOC_MAX_DEPTH}`);
  });

  test("safeLinkHref returns the address verbatim or null, never a new destination", () => {
    expect(safeLinkHref("https://a.b/x?y=1")).toBe("https://a.b/x?y=1");
    expect(safeLinkHref("  https://a.b  ")).toBe("https://a.b");
    expect(safeLinkHref("bbc.co.uk")).toBeNull();
    expect(safeLinkHref("javascript:alert(1)")).toBeNull();
    expect(safeLinkHref(42)).toBeNull();
  });
});
