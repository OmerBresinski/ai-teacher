import { Pencil } from "lucide-react";
import { useEffect, useRef } from "react";

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
  const headingRef = useRef<HTMLHeadingElement>(null);
  const Heading = as;

  useEffect(() => {
    if (!onCommit) return;
    const heading = headingRef.current;
    if (!heading) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "F2") return;
      event.preventDefault();
      event.stopPropagation();
      rename.start();
    };

    heading.addEventListener("dblclick", rename.start);
    heading.addEventListener("keydown", onKeyDown);
    return () => {
      heading.removeEventListener("dblclick", rename.start);
      heading.removeEventListener("keydown", onKeyDown);
    };
  }, [onCommit, rename]);

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
      <Heading ref={headingRef} className="min-w-0" tabIndex={0}>
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
