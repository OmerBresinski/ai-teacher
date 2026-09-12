import { cva } from "class-variance-authority";

/** Compact editor actions share UI states while their toolbar owns layout and semantics. */
export const toolbarButtonVariants = cva(
  "inline-flex h-8 items-center rounded-control text-body text-foreground outline-none motion-safe:transition-colors duration-(--duration-fast) ease-(--ease-out-soft) hover:bg-accent active:bg-accent-active focus-visible:shadow-focus data-[state=open]:bg-accent-active disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      kind: {
        action: "gap-1 px-2",
        dropdown: "gap-0.5 px-1.5",
      },
    },
    defaultVariants: { kind: "action" },
  },
);

/** Source selection cards: callers retain native button semantics and own their content. */
export const selectionCardVariants = cva(
  "flex w-full rounded-card border border-border bg-card text-left outline-none hover:bg-accent active:bg-accent-active focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      selected: { true: "border-primary ring-1 ring-primary", false: "" },
    },
    defaultVariants: { selected: false },
  },
);
