import { describe, expect, it } from "bun:test";
import type { RichDoc } from "@tj/domain/documents";
import { docLinkHref, normaliseHref, setDocLink } from "./links";
import { renderDocHTML } from "./static";

/* TeachDeck `lib/text/__tests__/links.test.ts`, the doc-rewriting half (`normaliseHref` has its own
   suite in `@tj/domain`). */

const doc = (content: unknown[]): RichDoc => ({
  type: "doc",
  content: content as RichDoc["content"],
});
const text = (value: string, marks?: unknown[]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const para = (content: unknown[]) => ({ type: "paragraph", content });
const LINK = { type: "link", attrs: { href: "https://bbc.co.uk/bitesize" } };

describe("the link mark off the editor", () => {
  it("re-exports the domain's normaliseHref (a bare host gets https, javascript: is refused)", () => {
    expect(normaliseHref("bbc.co.uk")).toBe("https://bbc.co.uk");
    expect(normaliseHref("javascript:alert(1)")).toBeNull();
  });

  it("reports no link on a plain doc", () => {
    expect(docLinkHref(doc([para([text("The water cycle")])]))).toBeNull();
    expect(docLinkHref(undefined)).toBeNull();
  });

  it("reads the first link in the box", () => {
    expect(docLinkHref(doc([para([text("Watch this", [LINK])])]))).toBe(
      "https://bbc.co.uk/bitesize",
    );
  });

  it("links every run in the box and takes them all off again", () => {
    const plain = doc([para([text("Watch "), text("this", [{ type: "bold" }])])]);
    const linked = setDocLink(plain, "https://bbc.co.uk/bitesize");
    expect(docLinkHref(linked)).toBe("https://bbc.co.uk/bitesize");
    expect(linked.content?.[0]?.content?.[1]?.marks).toEqual([{ type: "bold" }, LINK]);
    const stripped = setDocLink(linked, null);
    expect(docLinkHref(stripped)).toBeNull();
    expect(stripped.content?.[0]?.content?.[1]?.marks).toEqual([{ type: "bold" }]);
    // Never an empty marks array: Tiptap reads that as "explicitly unmarked".
    expect(stripped.content?.[0]?.content?.[0]?.marks).toBeUndefined();
  });

  it("replaces an address rather than stacking a second link", () => {
    const once = setDocLink(doc([para([text("here")])]), "https://one.example");
    const twice = setDocLink(once, "https://two.example");
    expect(twice.content?.[0]?.content?.[0]?.marks).toEqual([
      { type: "link", attrs: { href: "https://two.example" } },
    ]);
  });

  it("does not mutate the doc it is given", () => {
    const plain = doc([para([text("here")])]);
    const before = JSON.stringify(plain);
    setDocLink(plain, "https://one.example");
    expect(JSON.stringify(plain)).toBe(before);
  });

  it("renders a link as an anchor that opens in a new tab", () => {
    const html = renderDocHTML(doc([para([text("Watch this", [LINK])])]));
    expect(html).toContain('href="https://bbc.co.uk/bitesize"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(">Watch this</a>");
  });
});
