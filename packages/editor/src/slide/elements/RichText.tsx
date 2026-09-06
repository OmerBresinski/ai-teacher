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
}: {
  doc?: RichDoc;
  /** Pre-rendered HTML (used by gap-text, which post-processes the tokens). */
  html?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const markup = useMemo(() => html ?? (doc ? renderDocHTML(doc) : ""), [html, doc]);
  return (
    <div
      className={className ? `td-rt ${className}` : "td-rt"}
      style={style}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: `markup` is `renderDocHTML` output from our own Tiptap schema, never user HTML.
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
