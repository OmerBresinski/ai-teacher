import { cn, Kbd, Popover, PopoverAnchor, PopoverContent } from "@tj/ui";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { BLOCK_GROUPS, type BlockSpec, filterSpecs } from "./block-types";

/*
 * The insert menu (TeachDeck `components/v2/worksheet/SlashMenu.tsx`), reached by `/` in an empty
 * block or the `+` in the gutter. A `@tj/ui` Popover anchored to the block that asked for it, with
 * the filter box, four titled groups and a footer of keys. Filtering is BlockNote's substring rule
 * (`filterSpecs`) over `useState` query — derived during render, never in an effect.
 *
 * Keyboard: type to filter, ↑↓ to move, Enter to insert, Esc to close. `aria-activedescendant`
 * carries the highlight so the search box keeps focus while the list is driven.
 */

export type SlashMenuProps = {
  open: boolean;
  /** The block row that owns the menu; the popover is anchored to it. */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onPick: (spec: BlockSpec) => void;
};

export function SlashMenu({ open, anchorRef, onClose, onPick }: SlashMenuProps) {
  return (
    <Popover open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <PopoverAnchor virtualRef={anchorRef} />
      {open ? <SlashMenuBody onClose={onClose} onPick={onPick} /> : null}
    </Popover>
  );
}

/** Mounted only while open, so the query and highlight reset on every opening for free. */
function SlashMenuBody({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (spec: BlockSpec) => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const specs = filterSpecs(query);
  const active = specs[Math.min(index, Math.max(0, specs.length - 1))];
  const optionId = (spec: BlockSpec) => `${listId}-${spec.id}`;

  useEffect(() => {
    // Radix moves focus to the content on open; the filter box is the control that should have it.
    inputRef.current?.focus();
  }, []);

  const pick = (spec: BlockSpec | undefined) => {
    if (spec) onPick(spec);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => (specs.length ? (i + 1) % specs.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => (specs.length ? (i - 1 + specs.length) % specs.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  useEffect(() => {
    const el = active && document.getElementById(optionId(active));
    el?.scrollIntoView?.({ block: "nearest" });
  });

  return (
    <PopoverContent
      align="start"
      side="bottom"
      sideOffset={6}
      collisionPadding={12}
      className="w-72 p-0"
      aria-label="Insert a block"
      onOpenAutoFocus={(e) => e.preventDefault()}
      data-slash-menu
    >
      <div className="border-border border-b p-2">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Filter blocks…"
          role="combobox"
          aria-label="Filter blocks"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active ? optionId(active) : undefined}
          autoComplete="off"
          spellCheck={false}
          className="h-8 w-full rounded-control bg-transparent px-2 text-body text-foreground outline-none placeholder:text-ink-3 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>

      <div
        id={listId}
        role="listbox"
        aria-label="Block types"
        className="max-h-80 overflow-y-auto p-1.5"
      >
        {specs.length === 0 ? (
          <p className="m-0 px-2 py-3 text-body text-ink-3">No blocks match “{query}”.</p>
        ) : (
          BLOCK_GROUPS.map((group) => {
            const rows = specs.filter((s) => s.group === group);
            if (rows.length === 0) return null;
            return (
              // biome-ignore lint/a11y/useSemanticElements: a <fieldset> is a form grouping; these are option groups inside an ARIA listbox
              <div key={group} role="group" aria-label={group} className="mb-1 last:mb-0">
                <div className="px-2 pt-1.5 pb-1 font-semibold text-eyebrow text-ink-3 uppercase tracking-[0.08em]">
                  {group}
                </div>
                {rows.map((spec) => {
                  const selected = spec === active;
                  return (
                    <div
                      key={spec.id}
                      id={optionId(spec)}
                      role="option"
                      aria-selected={selected}
                      tabIndex={-1}
                      className={cn(
                        "flex cursor-default items-center gap-2.5 rounded-control px-2 py-1.5",
                        selected && "bg-accent",
                      )}
                      onPointerMove={() => {
                        const at = specs.indexOf(spec);
                        if (at !== index) setIndex(at);
                      }}
                      // Pointer down, not click: a click lands after the search box has blurred and
                      // Radix has begun closing the popover.
                      onPointerDown={(e) => {
                        e.preventDefault();
                        pick(spec);
                      }}
                      onKeyDown={onKeyDown}
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded-control bg-card text-ink-2 shadow-1">
                        {spec.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body text-foreground">
                          {spec.label}
                        </span>
                        <span className="block truncate text-meta text-ink-3">
                          {spec.description}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-center gap-3 border-border border-t px-3 py-1.5 text-meta text-ink-3">
        <span className="inline-flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> move
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>↵</Kbd> insert
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>esc</Kbd> close
        </span>
      </div>
    </PopoverContent>
  );
}
