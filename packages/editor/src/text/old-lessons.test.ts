import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { RichDocSchema } from "@tj/domain/documents";
import { serializeDoc } from "./serialize";

/*
 * Stored lessons serialise byte-identically after TEACH-205 part c (review of #529): the run
 * attributes add bytes only to runs that carry them. The corpus is every rich doc in the stored
 * master lessons (`slides/src/fixtures/stored-master-lessons.json`), once as stored and once with
 * the old marks laid over its text runs in turn (coloured bold, link italic, underline colour,
 * strike bold), so old coloured bold is pinned too. The hashes were taken with master's
 * `serialize.ts` (8c5587793) on this exact corpus.
 */
const MASTER_PLAIN = "588a2af1bb4c98af411459f780d80546aef6066791c9ca8a36848869647cdccb";
const MASTER_MARKED = "7c40a46bde63317bed788dea584392a229d4fd695c82154afba4353b2058908a";

const OLD_MARKS: unknown[][] = [
  [{ type: "bold" }, { type: "textStyle", attrs: { color: "#A94A18" } }],
  [{ type: "link", attrs: { href: "https://example.org", target: "_blank" } }, { type: "italic" }],
  [{ type: "underline" }, { type: "textStyle", attrs: { color: "#123456" } }],
  [{ type: "strike" }, { type: "bold" }],
  [],
];

const docs = (): unknown[] => {
  const url = new URL("../../../slides/src/fixtures/stored-master-lessons.json", import.meta.url);
  const out: unknown[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      if ((v as { type?: unknown }).type === "doc") out.push(v);
      else Object.values(v).forEach(walk);
    }
  };
  walk(JSON.parse(readFileSync(url, "utf8")));
  return out;
};

/** A copy of `doc` with the old mark sets laid over its text runs in turn. */
const marked = (doc: unknown): unknown => {
  let i = 0;
  const go = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(go);
    if (!n || typeof n !== "object") return n;
    const node = n as Record<string, unknown>;
    if (node.type === "text") return { ...node, marks: OLD_MARKS[i++ % OLD_MARKS.length] };
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, go(v)]));
  };
  return go(doc);
};

const hashOf = (list: unknown[]) =>
  createHash("sha256")
    .update(list.map((d) => serializeDoc(d as Parameters<typeof serializeDoc>[0])).join("\n"))
    .digest("hex");

describe("old lessons serialise byte-identically (TEACH-205 part c)", () => {
  const corpus = docs();

  test("the corpus is the stored master lessons", () => {
    expect(corpus.length).toBe(88);
  });

  test("as stored, and after a schema round trip", () => {
    expect(hashOf(corpus)).toBe(MASTER_PLAIN);
    expect(hashOf(corpus.map((d) => RichDocSchema.parse(d)))).toBe(MASTER_PLAIN);
  });

  test("with old marks (coloured bold nests <strong><span>), and after a schema round trip", () => {
    const withMarks = corpus.map(marked);
    expect(hashOf(withMarks)).toBe(MASTER_MARKED);
    expect(hashOf(withMarks.map((d) => RichDocSchema.parse(d)))).toBe(MASTER_MARKED);
  });
});
