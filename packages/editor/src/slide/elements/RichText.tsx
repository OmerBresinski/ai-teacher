import type { RichDoc } from "@tj/domain/documents";
import { type CSSProperties, useMemo } from "react";
import { renderDocHTML } from "../../text/static";

/**
 * The static rich-text path. Produces exactly the DOM Tiptap produces, with the same
 * `td-rt` class, so a text element does not shift when it enters or leaves edit mode.
 */
export function RichText({
  doc,
  className,
  style,
  html,
  step,
  maths,
}: {
  doc?: RichDoc;
  /** Pre-rendered HTML (used by gap-text, which post-processes the tokens). */
  html?: string;
  className?: string;
  style?: CSSProperties;
  /** The slide's reveal step: a myth strike for a later step is drawn hidden (TEACH-205 part c). */
  step?: number;
  /** The box holds maths (a worked equation cell, a formula): its fractions found as maths. */
  maths?: boolean;
}) {
  const markup = useMemo(
    () => strikesAt(html ?? (doc ? renderDocHTML(doc, { maths }) : ""), step),
    [html, doc, step, maths],
  );
  return (
    <div
      className={className ? `td-rt ${className}` : "td-rt"}
      style={style}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: `markup` is `renderDocHTML` output from our own Tiptap schema, never user HTML.
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

/**
 * Marks each myth strike (`data-strike="n"`, from `serialize.ts`) whose step is after `step` as
 * hidden. Only attributes inside a tag match: text is escaped, so it holds no `<`.
 */
export function strikesAt(markup: string, step: number | undefined): string {
  if (step === undefined || !markup.includes("data-strike=")) return markup;
  return markup.replace(/(<span\b[^>]*?) data-strike="(\d+)"/g, (whole, open: string, n: string) =>
    Number(n) > step ? `${open} data-strike="${n}" data-strike-hidden=""` : whole,
  );
}
