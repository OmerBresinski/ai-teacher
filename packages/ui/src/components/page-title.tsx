import { Pencil } from "lucide-react";

import { cn } from "../lib/cn";
import { useInlineRename } from "../lib/use-inline-rename";

import { Display } from "./display";
import { IconButton } from "./icon-button";
import { Input } from "./input";

export type PageTitleProps = {
  children: string;
  onCommit?: (title: string) => void;
  label: string;
  renameLabel: string;
  as?: "h1";
  className?: string;
};

function PageTitle({
  children,
  onCommit,
  label,
  renameLabel,
  as = "h1",
  className,
}: PageTitleProps) {
  const rename = useInlineRename(children, { onCommit: onCommit ?? (() => {}) });
  const Heading = as;

  if (!onCommit) {
    return (
      <Display as={as} size="lg" className={className}>
        {children}
      </Display>
    );
  }

  if (rename.editing) {
    return (
      <Input
        aria-label={label}
        className={cn("h-9 text-[28px] leading-9", className)}
        {...rename.inputProps}
      />
    );
  }

  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      <Heading
        className="min-w-0"
        tabIndex={0}
        onDoubleClick={rename.start}
        onKeyDown={rename.onCardKeyDown}
      >
        <Display as="span" size="lg" className="min-w-0 truncate">
          {children}
        </Display>
      </Heading>
      <IconButton label={renameLabel} size="sm" onClick={rename.start}>
        <Pencil aria-hidden size={16} strokeWidth={1.5} />
      </IconButton>
    </div>
  );
}

export { PageTitle };
