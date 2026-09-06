import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Skeleton,
  toast,
} from "@tj/ui";
import { useState } from "react";
import { KitGroup, Specimen, Variant } from "./frame";

function DialogSpecimen({ size }: { size: "sm" | "md" | "lg" | "full" }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary">Open {size}</Button>
      </DialogTrigger>
      <DialogContent size={size}>
        <DialogHeader>
          <DialogTitle>{size} dialog</DialogTitle>
          <DialogDescription>Dialog content is tokenized.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button>Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Feedback() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <KitGroup id="feedback" title="Feedback">
      <Specimen name="Dialog, sm md lg full" bleed>
        {(["sm", "md", "lg", "full"] as const).map((size) => (
          <DialogSpecimen key={size} size={size} />
        ))}
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary">Open non-dismissible</Button>
          </DialogTrigger>
          <DialogContent dismissible={false} showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Working</DialogTitle>
            </DialogHeader>
            <p>Wait for the work to complete.</p>
          </DialogContent>
        </Dialog>
      </Specimen>
      <Specimen name="ConfirmDialog, pending demo">
        <Button onClick={() => setConfirmOpen(true)}>Confirm after 1.5 seconds</Button>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Save changes?"
          body="The pending button stays disabled."
          confirmLabel="Save"
          onConfirm={() => new Promise((resolve) => setTimeout(resolve, 1500))}
        />
      </Specimen>
      <Specimen name="AlertDialog primitives">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline">Open alert</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Alert title</AlertDialogTitle>
              <AlertDialogDescription>
                An alert dialog has an explicit decision.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction>Continue</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Specimen>
      <Specimen name="Toast, default and Undo action">
        <Button onClick={() => toast("Lesson saved")}>Default toast</Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast("Lesson deleted", { action: { label: "Undo", onClick: () => toast("Restored") } })
          }
        >
          Toast with Undo
        </Button>
      </Specimen>
      <Specimen name="Skeleton">
        <Variant label="Content loading">
          <Skeleton className="h-8 w-48" />
        </Variant>
      </Specimen>
    </KitGroup>
  );
}
