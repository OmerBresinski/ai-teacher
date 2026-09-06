import { describe, expect, it } from "bun:test";
import type { RichDoc, RichNode } from "@tj/domain/documents";
import { docHasMark, docListType, setDocList, toggleDocMark } from "./doc-marks";

/* TeachDeck `lib/__tests__/doc-marks.test.ts` (11 cases). */

/** Freeze a doc all the way down so any mutation throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const text = (t: string, marks?: RichNode["marks"]): RichNode =>
  marks ? { type: "text", text: t, marks } : { type: "text", text: t };
const para = (...content: RichNode[]): RichNode => ({ type: "paragraph", content });
const item = (...content: RichNode[]): RichNode => ({ type: "listItem", content });

/** doc > bulletList > listItem > paragraph > text, with an inner list in item two. */
const nestedDoc = (): RichDoc => ({
  type: "doc",
  content: [
    {
      type: "bulletList",
      content: [
        item(para(text("Photosynthesis"))),
        item(para(text("Respiration")), {
          type: "bulletList",
          content: [item(para(text("In every living cell")))],
        }),
      ],
    },
  ],
});

function runs(node: RichNode | RichDoc, out: RichNode[] = []): RichNode[] {
  for (const child of node.content ?? []) {
    if (child.type === "text") out.push(child);
    else runs(child, out);
  }
  return out;
}

describe("toggleDocMark — nested lists", () => {
  it("marks every run in the tree, however deeply nested", () => {
    const next = toggleDocMark(nestedDoc(), "bold");
    const marked = runs(next);
    expect(marked).toHaveLength(3);
    expect(marked.map((r) => r.text)).toEqual([
      "Photosynthesis",
      "Respiration",
      "In every living cell",
    ]);
    for (const run of marked) expect(run.marks).toEqual([{ type: "bold" }]);
    expect(docHasMark(next, "bold")).toBe(true);
  });

  it("unmarks every nested run and removes the marks key rather than emptying it", () => {
    const bolded = toggleDocMark(nestedDoc(), "bold");
    const plain = toggleDocMark(bolded, "bold");
    expect(docHasMark(plain, "bold")).toBe(false);
    for (const run of runs(plain)) {
      expect(run.marks).toBeUndefined();
      expect(Object.hasOwn(run, "marks")).toBe(false);
    }
    expect(JSON.stringify(plain)).not.toContain("marks");
  });

  it("leaves other marks alone when one is toggled", () => {
    const doc: RichDoc = {
      type: "doc",
      content: [
        { type: "bulletList", content: [item(para(text("Italic already", [{ type: "italic" }])))] },
      ],
    };
    const bolded = toggleDocMark(doc, "bold");
    expect(runs(bolded)[0]?.marks).toEqual([{ type: "italic" }, { type: "bold" }]);
    const unbolded = toggleDocMark(bolded, "bold");
    expect(runs(unbolded)[0]?.marks).toEqual([{ type: "italic" }]);
    expect(docHasMark(unbolded, "italic")).toBe(true);
  });
});

describe("docHasMark", () => {
  const mixed: RichDoc = {
    type: "doc",
    content: [
      {
        type: "bulletList",
        content: [item(para(text("Bold one", [{ type: "bold" }]))), item(para(text("Plain two")))],
      },
    ],
  };

  it("is false while any run is unmarked, so the next toggle marks everything", () => {
    expect(docHasMark(mixed, "bold")).toBe(false);
    expect(docHasMark(toggleDocMark(mixed, "bold"), "bold")).toBe(true);
  });

  it("is true only when every run carries the mark", () => {
    expect(docHasMark(toggleDocMark(nestedDoc(), "italic"), "italic")).toBe(true);
    expect(docHasMark(nestedDoc(), "italic")).toBe(false);
  });

  it("is false for an empty doc and for no doc at all", () => {
    expect(docHasMark({ type: "doc", content: [] }, "bold")).toBe(false);
    expect(docHasMark(undefined, "bold")).toBe(false);
  });
});

describe("purity", () => {
  it("never touches the doc it was given", () => {
    const doc = deepFreeze(nestedDoc());
    const before = JSON.stringify(doc);
    const bolded = toggleDocMark(doc, "bold");
    expect(() => toggleDocMark(bolded, "bold")).not.toThrow();
    expect(JSON.stringify(doc)).toBe(before);
    expect(bolded).not.toBe(doc);
  });

  it("leaves an already-marked doc untouched when marks are stripped", () => {
    const doc = deepFreeze(toggleDocMark(nestedDoc(), "bold"));
    const before = JSON.stringify(doc);
    toggleDocMark(doc, "bold");
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("does not touch the doc handed to setDocList", () => {
    const doc = deepFreeze(nestedDoc());
    const before = JSON.stringify(doc);
    setDocList(doc, "orderedList");
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe("setDocList", () => {
  const flat: RichDoc = { type: "doc", content: [para(text("One")), para(text("Two"))] };

  it("round-trips bulletList to orderedList to none and back without nesting a list in itself", () => {
    const bullets = setDocList(flat, "bulletList");
    const numbered = setDocList(bullets, "orderedList");
    const none = setDocList(numbered, null);
    const again = setDocList(none, "bulletList");
    expect(docListType(bullets)).toBe("bulletList");
    expect(docListType(numbered)).toBe("orderedList");
    expect(docListType(none)).toBe(null);
    expect(docListType(again)).toBe("bulletList");
    expect(none).toEqual(flat);
    expect(again).toEqual(bullets);
    for (const doc of [bullets, numbered, again]) {
      const list = doc.content?.[0];
      expect(list?.content).toHaveLength(2);
      for (const li of list?.content ?? []) {
        expect(li.type).toBe("listItem");
        expect(li.content?.map((n) => n.type)).toEqual(["paragraph"]);
      }
    }
  });

  it("keeps every run's marks through a list change", () => {
    const listed = setDocList(toggleDocMark(flat, "bold"), "bulletList");
    expect(docHasMark(listed, "bold")).toBe(true);
  });
});
