import { findNamePatterns, GUARD_MESSAGE } from "@tj/domain/documents";
import { Label } from "@tj/ui";
import type { ReactNode } from "react";

/** A labelled control with an optional helper line below it. */
export function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="!text-foreground">
        {label}
      </Label>
      {children}
      {hint}
    </div>
  );
}

/**
 * The identifier guard's helper line (ADR 0024 §2): `GUARD_MESSAGE` and the field's text with each
 * offending match wrapped in `<mark>`. Renders nothing when the text is clean.
 */
export function GuardHint({ id, text }: { id: string; text: string }) {
  const patterns = findNamePatterns(text);
  if (patterns.length === 0) return null;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const pattern of patterns) {
    if (pattern.index < cursor) continue;
    parts.push(text.slice(cursor, pattern.index));
    parts.push(
      <mark
        key={`${pattern.index}-${pattern.match}`}
        className="rounded-xs bg-destructive/15 px-0.5"
      >
        {pattern.match}
      </mark>,
    );
    cursor = pattern.index + pattern.match.length;
  }
  parts.push(text.slice(cursor));
  return (
    <p id={id} role="alert" className="text-meta text-destructive">
      {GUARD_MESSAGE} <span className="text-ink-2">“{parts}”</span>
    </p>
  );
}
