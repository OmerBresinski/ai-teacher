import type { SourceLocator } from "@tj/domain/documents";

/** How a Source locator reads in a prompt: `p.3`, `slide 4`, `§Heading`; empty when it has none. */
export function describeRef(ref: SourceLocator): string {
  if (ref.page !== undefined) return `p.${ref.page}`;
  if (ref.slide !== undefined) return `slide ${ref.slide}`;
  if (ref.section !== undefined) return `§${ref.section}`;
  return "";
}
