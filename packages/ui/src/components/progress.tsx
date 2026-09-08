import type * as React from "react";

import { cn } from "../lib/cn";

/*
 * A determinate progress bar on the control-border track with an ink fill, 6px tall by default;
 * `value` undefined renders an indeterminate sweep. Replaces the native `<progress>` so the bar
 * follows the theme tokens in every theme.
 */

export type ProgressProps = Omit<React.ComponentProps<"div">, "children"> & {
  /** 0 to 100; leave undefined for indeterminate. */
  value?: number;
  /** The accessible name, e.g. "Generating". */
  label: string;
};

function Progress({ value, label, className, ...props }: ProgressProps) {
  const percent = value === undefined ? undefined : Math.min(100, Math.max(0, value));
  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={percent === undefined ? undefined : `${Math.round(percent)}%`}
      className={cn(
        "relative h-1.5 w-40 overflow-hidden rounded-full bg-border-control",
        className,
      )}
      {...props}
    >
      <div
        data-slot="progress-fill"
        className={cn(
          "h-full rounded-full bg-primary motion-safe:transition-[width]",
          percent === undefined && "w-1/3 motion-safe:animate-pulse",
        )}
        style={percent === undefined ? undefined : { width: `${percent}%` }}
      />
    </div>
  );
}

export { Progress };
