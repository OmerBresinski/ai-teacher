import { X } from "lucide-react";
import type * as React from "react";

import { cn } from "../lib/cn";
import { IconButton } from "./icon-button";
import { Input } from "./input";
import { Textarea } from "./textarea";

/*
 * One row of an editable list: an optional leading slot (a grip, a kind label), an inline text
 * field, an optional second field under it, an optional trailing control (a stepper, a badge) and
 * a remove button. The text is a real `Input`/`Textarea`, so the row is a plain form control to
 * assistive tech; the mark ("suggested" / "yours") is shown as a small label and read after the
 * field's name.
 */

export type EditableListField = {
  value: string;
  onChange: (value: string) => void;
  /** The field's accessible name, e.g. "Objective 2". */
  label: string;
  placeholder?: string;
  multiline?: boolean;
  ref?: React.Ref<HTMLInputElement & HTMLTextAreaElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement | HTMLTextAreaElement>;
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
  const shared = {
    value: field.value,
    "aria-label": mark ? `${field.label}, ${mark}` : field.label,
    placeholder: field.placeholder,
    onKeyDown: field.onKeyDown,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement> | React.ChangeEvent<HTMLTextAreaElement>,
    ) => field.onChange(event.target.value),
  };
  return field.multiline ? (
    <Textarea ref={field.ref} rows={2} className="min-h-16 resize-y" {...shared} />
  ) : (
    <Input ref={field.ref} {...shared} />
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
