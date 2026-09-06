import type { SlideElement, Theme } from "@tj/domain/documents";
import { IconButton, Input, Popover, PopoverContent, PopoverTrigger } from "@tj/ui";
import { Smile } from "lucide-react";
import { useMemo, useState } from "react";
import { RailButton } from "../../kit/Rail";
import { makeIcon } from "../../model/insert";
import { ICON_NAMES, ICONS } from "../../slide/elements";

/** The icon popover on the rail: a search field over the 7-column lucide grid. */
export function IconPicker({
  theme,
  onInsert,
}: {
  theme: Theme;
  onInsert: (el: SlideElement) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const names = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ICON_NAMES.filter((n) => n.includes(q)) : ICON_NAMES;
  }, [query]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setQuery("");
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <RailButton label="Icon">
          <Smile aria-hidden size={20} strokeWidth={1.5} />
        </RailButton>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-[264px] p-2" aria-label="Icon">
        <div className="flex flex-col gap-2">
          <Input
            autoFocus
            value={query}
            placeholder="Search icons"
            aria-label="Search icons"
            onChange={(e) => setQuery(e.target.value)}
            className="h-8"
          />
          <div className="grid max-h-[240px] grid-cols-7 gap-0.5 overflow-y-auto">
            {names.map((name) => {
              const Glyph = ICONS[name];
              if (!Glyph) return null;
              return (
                <IconButton
                  key={name}
                  label={name.replace(/-/g, " ")}
                  onClick={() => {
                    onInsert(makeIcon(name, theme));
                    setOpen(false);
                  }}
                >
                  <Glyph aria-hidden size={16} strokeWidth={1.5} />
                </IconButton>
              );
            })}
          </div>
          {names.length === 0 ? (
            <p className="m-0 px-1 pb-1 text-ink-3 text-meta">No icon matches “{query}”.</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
