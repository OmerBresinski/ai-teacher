import { Search, X } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/cn";

import { IconButton } from "./icon-button";
import { Input } from "./input";

export type SearchInputProps = Omit<
  React.ComponentProps<"input">,
  "type" | "value" | "onChange"
> & {
  label: string;
  placeholder: string;
  value: string;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  onClear?: () => void;
  width?: number;
};

const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { label, placeholder, value, onChange, onClear, width, className, onKeyDown, ...props },
  ref,
) {
  const clear = () => onClear?.();
  return (
    <div className={cn("relative flex h-8 items-center", className)} style={{ width }}>
      <Search
        aria-hidden
        size={16}
        strokeWidth={1.5}
        className="pointer-events-none absolute left-2.5 text-ink-3"
      />
      <Input
        ref={ref}
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || event.key !== "Escape") return;
          clear();
          event.currentTarget.blur();
        }}
        className="h-8 pl-8 pr-8"
        {...props}
      />
      {value ? (
        <IconButton
          label="Clear search"
          noTooltip
          size="sm"
          className="absolute right-1"
          onClick={clear}
        >
          <X aria-hidden size={16} strokeWidth={1.5} />
        </IconButton>
      ) : null}
    </div>
  );
});

export { SearchInput };
