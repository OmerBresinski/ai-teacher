import { ExtractError, type ExtractLimits } from "../types";

/** The subset consumed by Mammoth 1.12.3's default HTML converter. */
interface Node {
  type: string;
  children?: Node[];
  body?: Node[];
  [key: string]: unknown;
}

interface Document extends Node {
  notes: { resolve(reference: Node): Node | null };
}

/**
 * Runs in Mammoth's transformDocument hook, after its bounded ZIP read but BEFORE HTML or image
 * conversion. Count repeated note references as repeated work, not unique objects. Embedded style
 * maps are disabled by the caller: otherwise the archive could invent arbitrarily deep HTML paths.
 *
 * 1024 characters per model node conservatively covers the fixed tags/attributes emitted by the
 * pinned default converter; strings reserve six characters each for HTML escaping. Images become
 * short placeholders, not base64 HTML. Reserve the largest verified archive entry for each image
 * reference (Mammoth does not expose its entry path), including repeated references.
 */
export function boundDocxConversion<T>(
  value: T,
  limits: ExtractLimits,
  largestEntryBytes: number,
): T {
  const doc = value as Document;
  let htmlChars = 0;
  let imageBytes = 0;
  let nodes = 0;
  const stack = [{ node: doc as Node, depth: 0 }];
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) break;
    const { node, depth } = item;
    nodes += 1;
    if (depth > 64 || nodes > 50_000) throw new ExtractError("too-large", "docx");
    htmlChars += 1024;
    for (const field of Object.values(node)) {
      if (typeof field === "string") htmlChars += field.length * 6;
    }
    if (htmlChars > limits.maxTextChars) throw new ExtractError("too-large", "docx");
    if (node.type === "image") {
      imageBytes += largestEntryBytes;
      if (imageBytes > limits.maxImageBytesTotal) throw new ExtractError("too-large", "docx");
    }
    if (node.type === "noteReference") {
      const note = doc.notes.resolve(node);
      if (note) stack.push({ node: note, depth: depth + 1 });
    }
    for (const child of node.children ?? node.body ?? []) {
      stack.push({ node: child, depth: depth + 1 });
    }
  }
  return value;
}
