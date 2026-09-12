import { XMLParser } from "fast-xml-parser";

/*
 * Helpers over fast-xml-parser's `preserveOrder` output, which is the only mode that keeps text
 * runs in document order. A node is `{ [tag]: XmlNode[], ":@"?: attrs }` or `{ "#text": string }`.
 */

export type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  // Entities and DTDs are never expanded: the parser has no external-entity support and we
  // keep processing instructions/DOCTYPE out of the tree.
  processEntities: true,
  htmlEntities: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  trimValues: false,
});

export function parseXml(xml: string): XmlNode[] {
  const out = parser.parse(xml);
  return Array.isArray(out) ? (out as XmlNode[]) : [];
}

export function tagOf(node: XmlNode): string | undefined {
  return Object.keys(node).find((k) => k !== ":@" && k !== "#text");
}

export function childrenOf(node: XmlNode, tag: string): XmlNode[] {
  const kids = node[tag];
  return Array.isArray(kids) ? (kids as XmlNode[]) : [];
}

export function attrsOf(node: XmlNode): Record<string, string> {
  const attrs = node[":@"];
  return attrs && typeof attrs === "object" ? (attrs as Record<string, string>) : {};
}

/** Every `<a:t>` (or any `textTag`) under `nodes`, in document order. */
export function collectText(nodes: XmlNode[], textTag: string, out: string[] = []): string[] {
  for (const node of nodes) {
    const tag = tagOf(node);
    if (tag === undefined) continue;
    const kids = childrenOf(node, tag);
    if (tag === textTag) {
      out.push(kids.map((k) => (typeof k["#text"] === "string" ? k["#text"] : "")).join(""));
    } else {
      collectText(kids, textTag, out);
    }
  }
  return out;
}

/** Depth-first: every element named `tag` under `nodes` (not descending into matches). */
export function findAll(nodes: XmlNode[], tag: string, out: XmlNode[] = []): XmlNode[] {
  for (const node of nodes) {
    const t = tagOf(node);
    if (t === undefined) continue;
    if (t === tag) out.push(node);
    else findAll(childrenOf(node, t), tag, out);
  }
  return out;
}
