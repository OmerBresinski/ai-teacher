import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Spinner,
} from "@tj/ui";
import { useId, useState } from "react";

/**
 * State lives for the life of the mount: callers render the dialog only while it is open (or give
 * it a fresh `key`), so every opening starts clean without a reset effect.
 */
export type NewSeriesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (title: string) => void | Promise<void>;
};

export function NewSeriesDialog({ open, onOpenChange, onCreate }: NewSeriesDialogProps) {
  const titleId = useId();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await onCreate(title.trim() || "Untitled series");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" dismissible={!busy} showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>New series</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={titleId} className="!text-foreground">
              Title
            </Label>
            <Input
              id={titleId}
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="The Romans"
            />
          </div>
        </form>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-foreground text-background hover:bg-foreground"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? <Spinner /> : null}
            Create series
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
