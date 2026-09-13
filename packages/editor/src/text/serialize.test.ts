import { describe, expect, test } from "bun:test";
import { getSchema } from "@tiptap/core";
import { generateHTML } from "@tiptap/html";
import {
  RICH_MARK_TYPES,
  RICH_NODE_TYPES,
  type RichDoc,
  type RichNode,
} from "@tj/domain/documents";
import { docFromBullets, docFromText } from "../model/factories";
import { baseExtensions } from "./extensions";
import { serializeDoc, UnknownRichNodeError } from "./serialize";
import { docToPlainText, renderDocHTML } from "./static";

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
  markedHardBreak: {
    type: "doc",
    content: [
      p([
        t("a", [{ type: "bold" }]),
        { type: "hardBreak", marks: [{ type: "bold" }] },
        t("b", [{ type: "bold" }]),
      ]),
    ],
  },
  markRuns: {
    type: "doc",
    content: [
      p([
        t("a", [{ type: "bold" }]),
        t("b", [{ type: "bold" }, { type: "italic" }]),
        t("c", [{ type: "bold" }]),
        t("d", [{ type: "italic" }]),
        t("e"),
        t("f", [{ type: "italic" }]),
      ]),
    ],
  },
  adjacentLinks: {
    type: "doc",
    content: [
      p([
        t("l", [{ type: "link", attrs: { href: "https://x.y" } }]),
        t("m", [{ type: "link", attrs: { href: "https://x.z" } }]),
        t("n", [{ type: "link", attrs: { href: "https://x.z" } }]),
      ]),
    ],
  },
  linkAttrs: {
    type: "doc",
    content: [
      p([
        t("nulls", [
          {
            type: "link",
            // `target: null` is not here: the serialiser deliberately diverges from Tiptap and
            // always writes `_blank` (see the TEACH-277 block below).
            attrs: { href: "https://x.y", rel: null, class: null, title: "T" },
          },
        ]),
        t("full", [
          {
            type: "link",
            attrs: {
              href: "https://x.y",
              target: "_blank",
              rel: "nofollow",
              class: "c",
              title: null,
            },
          },
        ]),
      ]),
    ],
  },
  colourNull: {
    type: "doc",
    content: [p([t("t", [{ type: "textStyle", attrs: { color: null } }])])],
  },
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

  test("an empty text node — which ProseMirror refuses outright — serialises to nothing", () => {
    expect(() => tiptap({ type: "doc", content: [p([t("")])] })).toThrow(/Empty text/);
    expect(serializeDoc({ type: "doc", content: [p([t("", [{ type: "bold" }]), t("x")])] })).toBe(
      "<p><strong></strong>x</p>",
    );
  });

  test("an unknown node type throws so renderDocHTML can fall back", () => {
    expect(() =>
      serializeDoc({ type: "doc", content: [{ type: "heading", content: [t("h")] }] }),
    ).toThrow(UnknownRichNodeError);
    expect(() =>
      serializeDoc({ type: "doc", content: [p([t("x", [{ type: "highlight" }])])] }),
    ).toThrow(UnknownRichNodeError);
  });
});

/**
 * TEACH-277 (audit F01): the serialiser is the last step before `dangerouslySetInnerHTML` and
 * cannot trust stored attributes — Documents written before `RichDocSchema` was closed may carry
 * anything. Tiptap itself would happily emit these anchors, so no parity here: the assertions are
 * about what must NOT appear.
 */
describe("serializeDoc never emits an executable or injected attribute", () => {
  const link = (href: unknown, extra: Record<string, unknown> = {}) =>
    ({
      type: "doc",
      content: [p([t("click", [{ type: "link", attrs: { href, ...extra } }])])],
    }) as RichDoc;

  test.each([
    "javascript:void(document.body.dataset.auditXss=String(1))",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "\u0001javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "blob:https://app.example/uuid",
    "//evil.example/x",
    "/relative",
    "bbc.co.uk",
    "https://",
    "mailto:",
    "",
  ])("href %j renders the text without an anchor", (href) => {
    const html = serializeDoc(link(href));
    expect(html).toBe("<p>click</p>");
    expect(html).not.toContain("<a");
    expect(html).not.toMatch(/javascript|data:/i);
  });

  test("a non-string href is not a link", () => {
    expect(serializeDoc(link(null))).toBe("<p>click</p>");
    expect(serializeDoc(link(undefined))).toBe("<p>click</p>");
    expect(serializeDoc(link(["javascript:alert(1)"]))).toBe("<p>click</p>");
  });

  test("target is always _blank; unknown rel tokens fall back to the safe default", () => {
    expect(serializeDoc(link("https://x.y", { target: null }))).toBe(
      '<p><a target="_blank" rel="noopener noreferrer" href="https://x.y">click</a></p>',
    );
    expect(serializeDoc(link("https://x.y", { target: "_self" }))).toBe(
      '<p><a target="_blank" rel="noopener noreferrer" href="https://x.y">click</a></p>',
    );
    expect(serializeDoc(link("https://x.y", { target: "_top", rel: "opener" }))).toBe(
      '<p><a target="_blank" rel="noopener noreferrer" href="https://x.y">click</a></p>',
    );
    expect(serializeDoc(link("https://x.y", { rel: "nofollow noopener" }))).toContain(
      'rel="nofollow noopener"',
    );
  });

  test("legitimate http(s) and mailto links survive verbatim", () => {
    expect(serializeDoc(link("https://a.b/?q=1&r=2"))).toContain('href="https://a.b/?q=1&amp;r=2"');
    expect(serializeDoc(link("http://a.b/path#frag"))).toContain('href="http://a.b/path#frag"');
    expect(serializeDoc(link("mailto:head@school.sch.uk"))).toContain(
      'href="mailto:head@school.sch.uk"',
    );
  });

  test("textStyle colour and paragraph alignment cannot carry CSS declarations", () => {
    const colour = (color: unknown) =>
      serializeDoc({
        type: "doc",
        content: [p([t("c", [{ type: "textStyle", attrs: { color } }])])],
      });
    expect(colour("#f00")).toBe('<p><span style="color: #f00;">c</span></p>');
    expect(colour("rgb(1, 2, 3)")).toBe('<p><span style="color: rgb(1, 2, 3);">c</span></p>');
    expect(colour("red; background: url(https://evil.example/x)")).toBe("<p><span>c</span></p>");
    expect(colour("expression(alert(1))")).toBe("<p><span>c</span></p>");
    expect(colour('red" onmouseover="alert(1)')).toBe("<p><span>c</span></p>");
    const align = (textAlign: unknown) =>
      serializeDoc({ type: "doc", content: [p([t("a")], { textAlign })] });
    expect(align("center")).toBe('<p style="text-align: center;">a</p>');
    expect(align("center; position: fixed")).toBe("<p>a</p>");
    expect(align(null)).toBe("<p>a</p>");
  });

  test("an ordered list start that is not an integer is dropped", () => {
    const ol = (start: unknown) =>
      serializeDoc({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { start },
            content: [{ type: "listItem", content: [p([t("x")])] }],
          },
        ],
      });
    expect(ol(3)).toBe('<ol start="3"><li><p>x</p></li></ol>');
    expect(ol(2.5)).toBe("<ol><li><p>x</p></li></ol>");
    expect(ol('3" onclick="x')).toBe("<ol><li><p>x</p></li></ol>");
  });

  test("renderDocHTML (the sink's input) carries the same guarantee, cache included", () => {
    const doc = link("javascript:alert(1)");
    expect(renderDocHTML(doc)).toBe("<p>click</p>");
    expect(renderDocHTML(doc)).toBe("<p>click</p>");
  });
});

describe("legacy documents deeper than the schema allows (TEACH-277 review)", () => {
  test("renderDocHTML falls back to plain text instead of overflowing the stack", () => {
    let node: RichNode = { type: "paragraph", content: [t("deep")] };
    for (let i = 0; i < 20_000; i += 1) {
      node = { type: "bulletList", content: [{ type: "listItem", content: [node] }] };
    }
    const doc: RichDoc = { type: "doc", content: [node] };
    expect(renderDocHTML(doc)).toBe("<p>deep</p>");
    expect(docToPlainText(doc)).toBe("deep");
  });
});

describe("the closed domain schema mirrors baseExtensions", () => {
  test("node and mark names of the editor's Tiptap schema are exactly the domain allow-lists", () => {
    const schema = getSchema(baseExtensions);
    const nodes = Object.keys(schema.nodes)
      .filter((n) => n !== "doc")
      .sort();
    const marks = Object.keys(schema.marks).sort();
    expect(nodes).toEqual([...RICH_NODE_TYPES].sort());
    expect(marks).toEqual([...RICH_MARK_TYPES].sort());
  });
});
