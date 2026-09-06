import type { Theme } from "@tj/domain/documents";
import { fontFloor } from "../model/themes";
import type { MeasureInput, Measurer } from "./reflow";

/**
 * The fitting engine's test ruler (TeachDeck `demo-lint.test.ts` / `layout-recipes.test.ts`): ~0.5em
 * average advance, the caller's own leading, chrome on top. happy-dom cannot lay out text, so the
 * pure modules are tested against this instead of the DOM ruler.
 */
export const rulerFor =
  (theme: Theme): Measurer =>
  (input: MeasureInput) => {
    const size =
      input.fontSize ?? Math.max(theme.sizes[input.preset], fontFloor(input.preset, input.role));
    const leading = input.style?.lineHeight ?? theme.lineHeights[input.preset];
    const width = Math.max(1, input.width - input.inset);
    const perLine = Math.max(1, Math.floor(width / (size * 0.5)));
    const lines = paragraphs(input.doc).reduce(
      (n, p) => n + Math.max(1, Math.ceil(p.length / perLine)),
      0,
    );
    return lines * size * leading + input.chrome;
  };

type Node = { type?: string; text?: string; content?: Node[] };

function paragraphs(doc: Node): string[] {
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.type === "paragraph") {
      out.push(textOf(node));
      return;
    }
    node.content?.forEach(walk);
  };
  walk(doc);
  return out.length ? out : [""];
}

function textOf(node: Node): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(textOf).join("");
}
