import { X } from "lucide-react";
import type * as React from "react";
import { useLayoutEffect, useRef } from "react";

import { cn } from "../lib/cn";
import { IconButton } from "./icon-button";
import { Textarea } from "./textarea";

/*
 * One row of an editable list: an optional leading slot (a grip, a kind label), an inline text
 * field, an optional second field under it, an optional trailing control (a stepper, a badge) and
 * a remove button. The text is a `Textarea` that sits on one line and grows with its content, so
 * a long objective or summary always reads in full. Enter never inserts a newline (the step above
 * treats it as "continue"); Shift+Enter does, only in a `multiline` field. The mark ("suggested" /
 * "yours") is shown as a small label and read after the field's name.
 */

export type EditableListField = {
  value: string;
  onChange: (value: string) => void;
  /** The field's accessible name, e.g. "Objective 2". */
  label: string;
  placeholder?: string;
  /** Shift+Enter inserts a newline; without it the field stays one logical line. */
  multiline?: boolean;
  ref?: React.Ref<HTMLTextAreaElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
};

export type EditableListRowProps = Omit<React.ComponentProps<"li">, "children"> & {
  field: EditableListField;
  secondary?: EditableListField;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  /** "suggested" until the teacher touches the row, then "yours". */
  mark?: "suggested" | "yours";
  onRemove?: () => void;
  removeLabel?: string;
};

function TextField({ field, mark }: { field: EditableListField; mark?: string }) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  // Grow to the content (`field-sizing: content` where supported; the measured height elsewhere).
  useLayoutEffect(() => {
    const element = inner.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  });
  const setRef = (element: HTMLTextAreaElement | null) => {
    inner.current = element;
    const { ref } = field;
    if (typeof ref === "function") ref(element);
    else if (ref) ref.current = element;
  };
  return (
    <Textarea
      ref={setRef}
      rows={1}
      value={field.value}
      aria-label={mark ? `${field.label}, ${mark}` : field.label}
      placeholder={field.placeholder}
      data-multiline={field.multiline ? "" : undefined}
      className="field-sizing-content min-h-8 resize-none overflow-hidden px-3 py-1.5 leading-5"
      onChange={(event) => field.onChange(event.target.value)}
      onKeyDown={(event) => {
        // A newline only on Shift+Enter in a multi-line field; plain Enter belongs to the step.
        if (event.key === "Enter" && !(event.shiftKey && field.multiline)) event.preventDefault();
        field.onKeyDown?.(event);
      }}
    />
  );
}

function EditableListRow({
  field,
  secondary,
  leading,
  trailing,
  mark,
  onRemove,
  removeLabel = "Remove",
  className,
  ...props
}: EditableListRowProps) {
  return (
    <li
      data-slot="editable-list-row"
      data-mark={mark}
      className={cn(
        "flex items-start gap-2 rounded-card border border-border bg-card p-2 shadow-1",
        className,
      )}
      {...props}
    >
      {leading ? <div className="flex h-8 shrink-0 items-center">{leading}</div> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <TextField field={field} mark={mark} />
        {secondary ? <TextField field={secondary} mark={mark} /> : null}
      </div>
      {mark ? (
        <span
          aria-hidden
          className={cn(
            "flex h-8 shrink-0 items-center text-eyebrow font-medium",
            mark === "yours" ? "text-brand-text" : "text-ink-3",
          )}
        >
          {mark}
        </span>
      ) : null}
      {trailing ? <div className="flex h-8 shrink-0 items-center">{trailing}</div> : null}
      {onRemove ? (
        <IconButton label={removeLabel} onClick={onRemove} className="shrink-0">
          <X aria-hidden size={16} strokeWidth={1.5} />
        </IconButton>
      ) : null}
    </li>
  );
}

export { EditableListRow };
