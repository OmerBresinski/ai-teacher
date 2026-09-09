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
import { type ReactNode, useState } from "react";
import { EstimateText } from "@/components/generation-estimate/estimate-text";
import { ESTIMATE_HISTORY_FIXTURE, RUN_STEPS, runEvents } from "@/lib/generation-estimate.fixture";
import { KitGroup, Specimen, Variant } from "./frame";

/**
 * TEACH-201: the time-left line for the generating view, on the recorded run at "Slide 3 of 8".
 * The live variant's events are stamped an hour ahead of the page's load: time spent floors at
 * zero, so the reading is the fresh one, and the late timer cannot fall due while the page is
 * open. The late variant is stamped two minutes back so its stage is already past its high bound.
 */
const KIT_LOADED_AT = Date.now();
const WRITING_STEPS = RUN_STEPS.slice(0, 6);
const WRITING_NOW = runEvents(KIT_LOADED_AT + 3_600_000, WRITING_STEPS);
const WRITING_STALLED = runEvents(KIT_LOADED_AT - 120_000, WRITING_STEPS);

function StageLine({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-baseline gap-3 text-body">
      <span className="font-medium">Writing the slides, 3 of 8</span>
      {children}
    </span>
  );
}

const dialogs = [
  ["sm", "Rename lesson", "Rename lesson", "The new name shows in the library and the top bar."],
  [
    "md",
    "Lesson settings",
    "Lesson settings",
    "Year group, subject and the theme for every slide.",
  ],
  [
    "lg",
    "Choose a template",
    "Choose a template",
    "Pick a starting point; every slide stays editable.",
  ],
  ["full", "Import a deck", "Import a deck", "Drop a PowerPoint or Google Slides export here."],
] as const;

function DialogSpecimen({
  size,
  trigger,
  title,
  body,
}: {
  size: "sm" | "md" | "lg" | "full";
  trigger: string;
  title: string;
  body: string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary">{trigger}</Button>
      </DialogTrigger>
      <DialogContent size={size}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="primary">Done</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Feedback() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <KitGroup
      id="feedback"
      title="Feedback"
      rule="Dialog titles are Lora 20 at radius 12. One primary in the footer, the rest text. A toast carries at most one action, and it is Undo."
    >
      <Specimen name="Dialog, four widths" note="Rename, settings, template and import." bleed>
        {dialogs.map(([size, trigger, title, body]) => (
          <DialogSpecimen key={size} size={size} trigger={trigger} title={title} body={body} />
        ))}
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary">Generating slides</Button>
          </DialogTrigger>
          <DialogContent dismissible={false} showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Writing your lesson</DialogTitle>
            </DialogHeader>
            <p className="text-body text-ink-2">
              About a minute. The dialog closes on its own when the slides are ready.
            </p>
          </DialogContent>
        </Dialog>
      </Specimen>
      <Specimen
        name="ConfirmDialog, pending"
        note="The primary stays disabled while the work runs."
      >
        <Button variant="primary" onClick={() => setConfirmOpen(true)}>
          Save changes
        </Button>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Save changes?"
          body="Pupils who open the lesson after this see the new version."
          confirmLabel="Save"
          onConfirm={() => new Promise((resolve) => setTimeout(resolve, 1500))}
        />
      </Specimen>
      <Specimen
        name="AlertDialog primitives"
        note="An explicit decision the teacher cannot dismiss by clicking away."
      >
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline">Leave without saving</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
              <AlertDialogDescription>Changes to three slides will be lost.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep editing</AlertDialogCancel>
              <AlertDialogAction>Leave</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Specimen>
      <Specimen name="Toast, plain and with Undo">
        <Button variant="primary" onClick={() => toast("Lesson saved")}>
          Save lesson
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast("Lesson deleted", {
              action: { label: "Undo", onClick: () => toast("Lesson restored") },
            })
          }
        >
          Delete lesson
        </Button>
      </Specimen>
      <Specimen
        name="Time estimate"
        note="A range from stage history, rounded outwards. It changes only when an event arrives; with no history the stage line carries the counts on its own."
      >
        <Variant label="With history">
          <StageLine>
            <EstimateText history={ESTIMATE_HISTORY_FIXTURE} events={WRITING_NOW} slides={8} />
          </StageLine>
        </Variant>
        <Variant label="No history">
          <StageLine>
            <EstimateText history={null} events={WRITING_NOW} slides={8} />
          </StageLine>
        </Variant>
        <Variant label="Past the high bound">
          <StageLine>
            <EstimateText history={ESTIMATE_HISTORY_FIXTURE} events={WRITING_STALLED} slides={8} />
          </StageLine>
        </Variant>
      </Specimen>
      <Specimen name="Skeleton" note="A title line while the library loads.">
        <Variant label="Loading a title">
          <Skeleton className="h-8 w-48" />
        </Variant>
      </Specimen>
    </KitGroup>
  );
}
