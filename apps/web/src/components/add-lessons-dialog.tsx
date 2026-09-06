/**
 * Pick lessons to add to a series. No consumer yet: the series detail page (TEACH-92) mounts it
 * through `React.lazy` like `NewDocumentDialog` in `library-page.tsx`, so it stays out of the
 * initial bundle. Import it lazily; never statically from a route that is in the initial load.
 *
 * State lives for the life of the mount: render it only while open (or give it a fresh `key`), so
 * every opening starts clean without a reset effect.
 */
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  SearchInput,
  Spinner,
} from "@tj/ui";
import { useId, useMemo, useState } from "react";
import type { DocumentSummary } from "@/mocks/library-schema";

export type AddLessonsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: DocumentSummary[];
  hasLessons: boolean;
  onAdd: (lessonIds: string[]) => void | Promise<void>;
};

export function AddLessonsDialog({
  open,
  onOpenChange,
  candidates,
  hasLessons,
  onAdd,
}: AddLessonsDialogProps) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? candidates.filter((candidate) => candidate.title.toLowerCase().includes(normalized))
      : candidates;
  }, [candidates, query]);
  const label =
    selected.size === 0
      ? "Add lessons"
      : `Add ${selected.size} ${selected.size === 1 ? "lesson" : "lessons"}`;

  function toggle(id: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function submit(): Promise<void> {
    if (busy || selected.size === 0) return;
    setBusy(true);
    try {
      // Library order, not click order.
      await onAdd(candidates.filter((candidate) => selected.has(candidate.id)).map((c) => c.id));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" dismissible={!busy} showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Add lessons</DialogTitle>
        </DialogHeader>
        {candidates.length === 0 ? (
          hasLessons ? (
            <EmptyState title="No lessons left to add" className="max-w-none" />
          ) : (
            <EmptyState
              title="No lessons yet"
              body="Make one in the library first."
              className="max-w-none"
            />
          )
        ) : (
          <div className="flex flex-col gap-3">
            <label htmlFor={searchId} className="sr-only">
              Search titles
            </label>
            <SearchInput
              id={searchId}
              label="Search titles"
              placeholder="Search titles"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery("")}
            />
            {filtered.length === 0 ? (
              <p className="text-body font-medium text-ink-3">Nothing matches that</p>
            ) : (
              <fieldset className="max-h-80 overflow-y-auto">
                <legend className="sr-only">Lessons</legend>
                {filtered.map((candidate) => (
                  <LessonRow
                    key={candidate.id}
                    candidate={candidate}
                    checked={selected.has(candidate.id)}
                    onCheckedChange={() => toggle(candidate.id)}
                  />
                ))}
              </fieldset>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-foreground text-background hover:bg-foreground"
            disabled={busy || selected.size === 0}
            onClick={() => void submit()}
          >
            {busy ? <Spinner /> : null}
            {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LessonRow({
  candidate,
  checked,
  onCheckedChange,
}: {
  candidate: DocumentSummary;
  checked: boolean;
  onCheckedChange: () => void;
}) {
  const checkboxId = useId();
  const titleId = useId();
  return (
    <div className="flex items-center gap-3 rounded-card px-2 py-1.5 hover:bg-accent">
      <Checkbox
        id={checkboxId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-labelledby={titleId}
      />
      <label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer">
        <span id={titleId} className="block truncate text-body font-medium">
          {candidate.title}
        </span>
        <span className="block truncate text-micro text-ink-3">
          {candidate.count} {candidate.count === 1 ? "slide" : "slides"}
          {candidate.yearGroup ? ` · ${candidate.yearGroup}` : ""}
          {candidate.subject ? ` · ${candidate.subject}` : ""}
        </span>
      </label>
    </div>
  );
}
