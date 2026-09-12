import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { readDocumentFile } from "@tj/editor/export";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Spinner,
  toast,
} from "@tj/ui";
import { Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import { libraryMutations } from "@/lib/library";
import { ApiError } from "@/lib/query";

/**
 * The library's Import dialog (TeachDeck `app/v2/(library)/import.tsx`; ADR 0023 §6, amended
 * 2026-09-12). A drop zone and a file picker for one or many `.teachdeck.json` /
 * `.worksheet.json` files. Each file is read and parsed on the client first (`readDocumentFile` runs
 * `migrate()` then the schema, so a newer-version or malformed file is refused with TeachDeck's copy
 * before any request), then posted whole through `libraryMutations.importDocument`; the server
 * assigns the id. One toast per outcome, in TeachDeck's words; a file that fails does not stop the
 * others.
 */
export type ImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const NOT_JSON_MESSAGE = "That file is not a TeachDeck JSON export.";
export const TOO_LARGE_MESSAGE = "This file is too large to import (10 MB limit).";

const isJsonFile = (file: File) => file.name.endsWith(".json") || file.type === "application/json";

/** The one line a teacher needs about a file that did not import: its name and what was wrong. */
function failureMessage(file: File, error: unknown): string {
  if (error instanceof ApiError && error.status === 413) {
    return `Could not import “${file.name}”. ${TOO_LARGE_MESSAGE}`;
  }
  const reason = error instanceof Error ? error.message : "It is not a TeachDeck export.";
  return `Could not import “${file.name}”. ${reason}`;
}

export function ImportDialog({ open, onOpenChange }: ImportDialogProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { mutateAsync: importDocument } = useMutation(libraryMutations.importDocument(queryClient));
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const dropLabelId = `${inputId}-drop`;
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const importFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter(isJsonFile);
    if (list.length === 0) {
      toast(NOT_JSON_MESSAGE);
      return;
    }
    setBusy(true);
    const imported: { id: string; title: string; worksheet: boolean }[] = [];
    try {
      for (const file of list) {
        try {
          const body = await readDocumentFile(file);
          const created = await importDocument(body);
          imported.push({ id: created.id, title: created.title, worksheet: "blocks" in body });
        } catch (error) {
          toast(failureMessage(file, error));
        }
      }
      // One outcome toast: the title with an Open action when exactly one landed (whatever else
      // was dropped beside it), the count otherwise.
      const only = imported.length === 1 ? imported[0] : undefined;
      if (only) {
        toast(`Imported “${only.title}”`, {
          action: {
            label: "Open",
            onClick: () =>
              void (only.worksheet
                ? navigate({ to: "/w/$worksheetId", params: { worksheetId: only.id } })
                : navigate({ to: "/l/$lessonId", params: { lessonId: only.id } })),
          },
        });
      } else if (imported.length > 1) {
        toast(`Imported ${imported.length} documents`);
      }
      if (imported.length > 0) onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size="sm" dismissible={!busy} showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Import</DialogTitle>
          <DialogDescription>
            Bring in a lesson or worksheet exported as JSON. Both kinds go in the same drop.
          </DialogDescription>
        </DialogHeader>
        {/* A drop target is not a control: the drag handlers stay on the region and the
            click-to-browse affordance is the real Button inside it (the ImagePicker's pattern). */}
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: drop handlers only; the Button inside is the activation */}
        {/* biome-ignore lint/a11y/useSemanticElements: a drop zone is a named group, not a fieldset */}
        <div
          role="group"
          aria-labelledby={dropLabelId}
          data-import-dropzone
          data-dragging={dragging || undefined}
          className={
            "flex flex-col items-center gap-3 rounded-card border border-dashed border-border px-6 py-8 text-center text-meta text-ink-3 transition-colors data-[dragging]:border-primary data-[dragging]:bg-secondary"
          }
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setDragging(false);
          }}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            setDragging(false);
            if (!busy) void importFiles(e.dataTransfer.files);
          }}
        >
          <Upload aria-hidden size={20} strokeWidth={1.5} />
          <p id={dropLabelId} className="m-0">
            Drop a TeachDeck JSON file to import
          </p>
          <input
            ref={input}
            id={inputId}
            type="file"
            accept="application/json,.json"
            multiple
            className="sr-only"
            aria-label="Import files"
            disabled={busy}
            onChange={(e) => {
              if (e.target.files?.length) void importFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {busy ? <Spinner size={16} /> : null}
            {busy ? "Importing…" : "Choose files"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
