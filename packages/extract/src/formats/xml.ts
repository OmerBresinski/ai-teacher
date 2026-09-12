import { XMLParser } from "fast-xml-parser";
import { ExtractError } from "../types";

/*
 * Helpers over fast-xml-parser's `preserveOrder` output, which is the only mode that keeps text
 * runs in document order. A node is `{ [tag]: XmlNode[], ":@"?: attrs }` or `{ "#text": string }`.
 */

export type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  // No entity expansion at all: a DOCTYPE in an untrusted PPTX could otherwise define entities
  // that amplify (billion laughs) or inject text. The five XML built-ins are decoded by hand
  // below; Office writes nothing else into `a:t`.
  processEntities: false,
  htmlEntities: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  trimValues: false,
});

const BUILTIN = /&(amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-fA-F]+);/g;
const BUILTIN_MAP: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Decode the XML built-in and numeric character references only. */
export function decodeXmlText(text: string): string {
  return text.replace(BUILTIN, (_, name, dec, hex) => {
    if (name !== undefined) return BUILTIN_MAP[name] ?? "";
    const code = dec !== undefined ? Number(dec) : Number.parseInt(hex, 16);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

/**
 * Parse one XML part. A parser failure is `malformed`; fast-xml-parser's own message quotes the
 * input around the error, which is document text, so it is never kept (ADR 0015).
 */
export function parseXml(xml: string, format: "pptx" | "docx"): XmlNode[] {
  let out: unknown;
  try {
    out = parser.parse(xml);
  } catch {
    throw new ExtractError("malformed", format);
  }
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
      out.push(
        decodeXmlText(kids.map((k) => (typeof k["#text"] === "string" ? k["#text"] : "")).join("")),
      );
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
