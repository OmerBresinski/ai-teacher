import type { Finding } from "@tj/domain/documents";
import {
  Button,
  cn,
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@tj/ui";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useLesson } from "./document-context";
import { thingsToCheck, useResidualFindings } from "./residual-findings";
import { useSessionActions } from "./use-editor-session";

/*
 * The canvas footer's residual entry (ADR 0025 §12): "N things to check" opens a popover listing
 * every finding's message, with "Go to slide" where the finding points at one. A `budget` finding
 * — generation stopped at the cap — is listed first and set apart, so the teacher sees why the
 * lesson is shorter than planned before any smaller point. Renders nothing when there is nothing.
 */

export function ResidualBadge({ className }: { className?: string }) {
  const { findings } = useResidualFindings();
  const lesson = useLesson();
  const { setActiveSlide } = useSessionActions();
  const [open, setOpen] = useState(false);
  if (findings.length === 0) return null;

  const budget = findings.filter((f) => f.check === "budget");
  const rest = findings.filter((f) => f.check !== "budget");
  const slideNumber = (id: string | undefined) => {
    if (id === undefined) return undefined;
    const i = lesson.slides.findIndex((s) => s.id === id);
    return i === -1 ? undefined : i + 1;
  };
  const goTo = (id: string) => {
    setActiveSlide(id);
    setOpen(false);
  };
  const worst = findings.some((f) => f.severity === "error") ? "error" : "warning";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          data-residual-footer
          className={cn("bg-card shadow-[inset_0_0_0_1px_var(--border-control)]", className)}
        >
          <AlertTriangle
            aria-hidden
            size={16}
            strokeWidth={1.5}
            className={worst === "error" ? "text-destructive" : "text-warning"}
          />
          {thingsToCheck(findings.length)}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-80" aria-label="Things to check">
        <PopoverHeader>
          <PopoverTitle>{thingsToCheck(findings.length)}</PopoverTitle>
        </PopoverHeader>
        <ul className="mt-2 flex flex-col gap-2 text-body">
          {budget.map((f) => (
            <li
              key={findingId(f)}
              data-finding-check="budget"
              className="rounded-chip border border-destructive/40 bg-destructive/5 p-2 font-medium"
            >
              {f.message}
            </li>
          ))}
          {rest.map((f) => {
            const n = slideNumber(f.target.slideId);
            return (
              <li
                key={findingId(f)}
                data-finding-check={f.check}
                className="flex items-start gap-2"
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 block size-2 shrink-0 rounded-full",
                    f.severity === "error" ? "bg-destructive" : "bg-warning",
                  )}
                />
                <span className="flex-1">
                  {f.message}
                  {n !== undefined && f.target.slideId ? (
                    <Button
                      variant="link"
                      size="sm"
                      className="ml-1 h-auto p-0"
                      onClick={() => f.target.slideId && goTo(f.target.slideId)}
                    >
                      Go to slide {n}
                    </Button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

const findingId = (f: Finding) =>
  [f.check, f.target.slideId, f.target.elementId, f.target.blockId, f.target.factId].join("|");
