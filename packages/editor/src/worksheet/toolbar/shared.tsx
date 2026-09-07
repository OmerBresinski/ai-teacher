import type { Id, WorksheetBlock } from "@tj/domain/documents";
import { Popover, PopoverContent, PopoverTrigger, Textarea } from "@tj/ui";
import { type ComponentProps, type ReactNode, useId, useState } from "react";
import { NumberInput, type NumberInputProps } from "../../kit/NumberInput";
import { PanelLabel } from "../../kit/Panel";
import { BarButton, ICON_SM } from "../../lesson/toolbar/shared";
import { useBlockWrites } from "../worksheet-context";

/*
 * What the worksheet toolbars share (TeachDeck `BlockToolbar.tsx` helpers): a labelled
 * `NumberInput` bound to one field of the selected block, a popover of free text (the lines of a
 * word bank, the gaps of a cloze), and the write helpers — `commit` for a click, `patch` for a
 * control that fires as it is typed or scrubbed (one undo step per run).
 */

export { BarButton, ICON_SM };

export type BlockOf<T extends WorksheetBlock["type"]> = Extract<WorksheetBlock, { type: T }>;

export type ToolbarProps<T extends WorksheetBlock["type"]> = { block: BlockOf<T> };

/** A labelled number field that writes one numeric field of the block as it is scrubbed. */
export function NumberField<T extends WorksheetBlock>({
  id,
  label,
  value,
  onValue,
  ...rest
}: {
  id: Id;
  label: string;
  value: number;
  /** Turn the new value into the patch; runs inside the typing session. */
  onValue: (value: number, block: T) => void;
} & Omit<NumberInputProps, "value" | "onChange" | "id" | "aria-label">) {
  const inputId = useId();
  const { patch } = useBlockWrites();
  return (
    <>
      <PanelLabel id={`${inputId}-label`} aria-hidden>
        {label}
      </PanelLabel>
      <NumberInput
        id={inputId}
        aria-label={label}
        value={value}
        onChange={(next) => patch<T>(id, (b) => onValue(next, b))}
        {...rest}
      />
    </>
  );
}

/**
 * Free text in a popover — one item per line — committed on blur or when the popover closes, so
 * a word bank or a table is rewritten as one undo step rather than one per keystroke.
 */
export function LinesPopover({
  label,
  title,
  hint,
  value,
  onCommit,
  rows = 6,
  align = "start",
}: {
  /** The trigger text and the textarea's name. */
  label: ReactNode;
  title: string;
  hint?: string;
  value: string;
  onCommit: (text: string) => void;
  rows?: number;
  align?: ComponentProps<typeof PopoverContent>["align"];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const id = useId();
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value);
        else if (draft !== value) onCommit(draft);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <BarButton>{label}</BarButton>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-72" aria-label={title}>
        <div className="flex flex-col gap-2">
          <label htmlFor={id} className="font-semibold text-body text-foreground">
            {title}
          </label>
          <Textarea
            id={id}
            rows={rows}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="resize-none text-body"
            spellCheck={false}
          />
          {hint ? <p className="m-0 text-meta text-ink-3">{hint}</p> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
