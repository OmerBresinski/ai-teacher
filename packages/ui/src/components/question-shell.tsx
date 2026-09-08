import type * as React from "react";
import { useId } from "react";

import { cn } from "../lib/cn";
import { Display } from "./display";

/*
 * One question on screen: the question as a full sentence in display type, an optional line of
 * help under it, the control, and a footer slot for the actions. The section is labelled by the
 * question so a screen reader lands on it as a region. Children arrive with the kit's arrive
 * animation; callers stagger their own rows with `--stagger`.
 */

export type QuestionShellProps = Omit<React.ComponentProps<"section">, "title"> & {
  question: React.ReactNode;
  help?: React.ReactNode;
  /** A short line above the question, e.g. "2 of 5". */
  eyebrow?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
};

function QuestionShell({
  question,
  help,
  eyebrow,
  footer,
  children,
  className,
  ...props
}: QuestionShellProps) {
  const id = useId();
  return (
    <section
      data-slot="question-shell"
      aria-labelledby={`${id}-question`}
      aria-describedby={help ? `${id}-help` : undefined}
      className={cn("flex flex-col gap-6", className)}
      {...props}
    >
      <header className="flex flex-col gap-2 motion-safe:animate-arrive">
        {eyebrow ? (
          <p className="text-eyebrow font-semibold text-ink-3 uppercase tracking-wide">{eyebrow}</p>
        ) : null}
        <Display as="h2" size="lg" id={`${id}-question`}>
          {question}
        </Display>
        {help ? (
          <p id={`${id}-help`} className="max-w-[60ch] text-lead text-ink-2">
            {help}
          </p>
        ) : null}
      </header>
      <div className="flex flex-col gap-3">{children}</div>
      {footer ? <footer className="flex flex-wrap items-center gap-3 pt-2">{footer}</footer> : null}
    </section>
  );
}

export { QuestionShell };
