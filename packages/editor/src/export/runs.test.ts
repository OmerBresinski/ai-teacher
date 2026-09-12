import { describe, expect, it } from "bun:test";
import type { RichDoc } from "@tj/domain/documents";
import { docToRuns, runsToText } from "./runs";

const doc = (content: unknown[]): RichDoc => ({
  type: "doc",
  content: content as RichDoc["content"],
});
const text = (value: string, marks?: unknown[]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
/** The first paragraph, which every single-paragraph case expects to exist. */
const first = (paragraphs: ReturnType<typeof docToRuns>) => {
  const p = paragraphs[0];
  if (!p) throw new Error("expected a paragraph");
  return p;
};
const para = (content: unknown[], attrs?: Record<string, unknown>) => ({
  type: "paragraph",
  content,
  ...(attrs ? { attrs } : {}),
});

/* TeachDeck `lib/export/__tests__/runs.test.ts` restated (TEACH-111 row 2). */
describe("docToRuns", () => {
  it("returns nothing for an empty or missing doc", () => {
    expect(docToRuns(undefined)).toEqual([]);
    expect(docToRuns(doc([]))).toEqual([]);
  });

  it("reads a plain paragraph as one run", () => {
    expect(docToRuns(doc([para([text("The water cycle")])]))).toEqual([
      { runs: [{ text: "The water cycle" }], level: 0 },
    ]);
  });

  it("carries bold, italic, underline, strike and colour", () => {
    const marks = [
      { type: "bold" },
      { type: "italic" },
      { type: "underline" },
      { type: "strike" },
      { type: "textStyle", attrs: { color: "#A94A18" } },
    ];
    const paragraph = first(docToRuns(doc([para([text("evaporation", marks)])])));
    expect(paragraph.runs[0]).toEqual({
      text: "evaporation",
      bold: true,
      italic: true,
      underline: true,
      strike: true,
      color: "#A94A18",
    });
  });

  it("carries a link address on the run", () => {
    const paragraph = first(
      docToRuns(
        doc([
          para([
            text("Bitesize", [{ type: "link", attrs: { href: "https://bbc.co.uk/bitesize" } }]),
          ]),
        ]),
      ),
    );
    expect(paragraph.runs[0]).toEqual({ text: "Bitesize", href: "https://bbc.co.uk/bitesize" });
  });

  it("keeps two adjacent links apart when the addresses differ", () => {
    const link = (href: string) => [{ type: "link", attrs: { href } }];
    const paragraph = first(
      docToRuns(
        doc([
          para([
            text("one", link("https://one.example")),
            text("two", link("https://two.example")),
          ]),
        ]),
      ),
    );
    expect(paragraph.runs.map((r) => r.href)).toEqual([
      "https://one.example",
      "https://two.example",
    ]);
  });

  it("ignores a link mark with no address", () => {
    const paragraph = first(docToRuns(doc([para([text("x", [{ type: "link", attrs: {} }])])])));
    expect(paragraph.runs[0]?.href).toBeUndefined();
  });

  it("treats strong/em aliases as bold/italic", () => {
    const paragraph = first(
      docToRuns(doc([para([text("x", [{ type: "strong" }, { type: "em" }])])])),
    );
    expect(paragraph.runs[0]).toMatchObject({ bold: true, italic: true });
  });

  it("ignores a textStyle mark with no colour", () => {
    const paragraph = first(
      docToRuns(doc([para([text("x", [{ type: "textStyle", attrs: {} }])])])),
    );
    expect(paragraph.runs[0]?.color).toBeUndefined();
  });

  it("merges adjacent runs that share a style and keeps the ones that do not", () => {
    const paragraph = first(
      docToRuns(
        doc([para([text("Water "), text("vapour"), text(" is invisible", [{ type: "bold" }])])]),
      ),
    );
    expect(paragraph.runs).toEqual([
      { text: "Water vapour" },
      { text: " is invisible", bold: true },
    ]);
  });

  it("keeps a deliberate blank paragraph", () => {
    const paragraphs = docToRuns(doc([para([text("one")]), para([]), para([text("two")])]));
    expect(paragraphs.map((p) => p.runs.length)).toEqual([1, 0, 1]);
  });

  it("reads paragraph alignment", () => {
    const paragraphs = docToRuns(doc([para([text("centred")], { textAlign: "center" })]));
    expect(paragraphs[0]?.align).toBe("center");
  });

  it("ignores an alignment value that is not a real alignment", () => {
    const paragraphs = docToRuns(doc([para([text("x")], { textAlign: "nonsense" })]));
    expect(paragraphs[0]?.align).toBeUndefined();
  });

  it("marks bullet list items", () => {
    const list = {
      type: "bulletList",
      content: [
        { type: "listItem", content: [para([text("first")])] },
        { type: "listItem", content: [para([text("second")])] },
      ],
    };
    expect(docToRuns(doc([list]))).toEqual([
      { runs: [{ text: "first" }], list: "bullet", level: 0 },
      { runs: [{ text: "second" }], list: "bullet", level: 0 },
    ]);
  });

  it("marks ordered list items", () => {
    const list = {
      type: "orderedList",
      content: [{ type: "listItem", content: [para([text("Name three places")])] }],
    };
    expect(docToRuns(doc([list]))[0]?.list).toBe("ordered");
  });

  it("counts nesting depth for a list inside a list", () => {
    const nested = {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            para([text("outer")]),
            {
              type: "bulletList",
              content: [{ type: "listItem", content: [para([text("inner")])] }],
            },
          ],
        },
      ],
    };
    expect(docToRuns(doc([nested])).map((p) => [p.runs[0]?.text, p.level])).toEqual([
      ["outer", 0],
      ["inner", 1],
    ]);
  });

  it("splits a hard break into a soft paragraph", () => {
    const paragraphs = docToRuns(
      doc([para([text("line one"), { type: "hardBreak" }, text("line two")])]),
    );
    expect(paragraphs).toEqual([
      { runs: [{ text: "line one" }], level: 0 },
      { runs: [{ text: "line two" }], level: 0, soft: true },
    ]);
  });

  it("joins back to the same plain text", () => {
    const paragraphs = docToRuns(doc([para([text("one")]), para([text("two")])]));
    expect(runsToText(paragraphs)).toBe("one\ntwo");
  });
});
