import type * as React from "react";

import { cn } from "../lib/cn";

export type ListSurfaceProps = React.ComponentProps<"table"> & {
  header?: React.ReactNode;
};

function ListSurface({ header, children, className, ...props }: ListSurfaceProps) {
  return (
    <table
      className={cn("w-full overflow-hidden rounded-card bg-card text-left shadow-1", className)}
      {...props}
    >
      {header ? <thead>{header}</thead> : null}
      <tbody>{children}</tbody>
    </table>
  );
}

function ListSurfaceHeader({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "h-9 border-b border-border-faint text-eyebrow font-semibold tracking-wide text-ink-3 uppercase",
        className,
      )}
      {...props}
    />
  );
}

function ListSurfaceRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "group/row h-14 border-b border-border-faint motion-safe:transition-colors hover:bg-accent focus-within:bg-accent",
        className,
      )}
      {...props}
    />
  );
}

export type ListSurfaceCellProps = React.ComponentProps<"td"> & {
  header?: boolean;
};

function ListSurfaceCell({ header = false, className, ...props }: ListSurfaceCellProps) {
  const classes = cn("min-w-0 px-3", className);
  return header ? (
    <th scope="col" className={classes} {...props} />
  ) : (
    <td className={classes} {...props} />
  );
}

export { ListSurface, ListSurfaceCell, ListSurfaceHeader, ListSurfaceRow };
