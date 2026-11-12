import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type Lesson, offeredRecipeFor } from "@tj/domain/documents";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@tj/ui";
import { FileText } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useJobEvents } from "@/hooks/use-job-events";
import {
  canRequestWorksheet,
  failureMessageOf,
  generationHandoff,
  lessonWorksheetsQuery,
  lessonWorksheetTypesQuery,
  persistWorksheetHandoff,
  requestLessonWorksheet,
  requestWorksheetRetryingOnce,
  retryIntentOf,
  subscribeWorksheetHandoff,
  TRYING_AGAIN_SHORTLY,
  WORKSHEET_ENTRY_LABEL,
  worksheetEntryState,
  worksheetHandoffSnapshot,
  worksheetStatusLabel,
} from "@/lib/lesson-worksheets";
import { sessionMutation } from "@/lib/session-boundary";

/** The offered type a remembered id means (`auto` is Practice, as the api reads it), else itself. */
const offeredTypeOf = (id: string): string => offeredRecipeFor(id) ?? id;

/** Independent worksheet jobs never keep the slide editor locked. */
export function LessonWorksheets({
  lesson,
  open,
  onOpenChange,
  onOpenWorksheet,
  trigger = true,
  onLabel,
  lessonBusy = false,
}: {
  lesson: Lesson;
  /**
   * A lesson job holds the lesson (`generatingJobId`): its slides may still be checked or
   * repaired, so no sheet is requested until it lets go (R4 review, 12 Nov).
   */
  lessonBusy?: boolean;
  /**
   * `false`: no button here. The editor lists the entry in its ⋯ menu and mounts this outside the
   * menu, so the dialog does not unmount when the menu closes.
   */
  trigger?: boolean;
  /** The entry's label as it changes ("Worksheet generating…"), for a trigger rendered elsewhere. */
  onLabel?: (label: string) => void;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onOpenWorksheet: (id: string) => void;
}) {
  const client = useQueryClient();
  const options = lessonWorksheetsQuery(client, lesson.id);
  const list = useQuery(options);
  const intent = generationHandoff(client, lesson.id);
  useSyncExternalStore(
    useCallback((notify) => subscribeWorksheetHandoff(client, notify), [client]),
    () => worksheetHandoffSnapshot(client, lesson.id),
  );
  // The offered launch types for this lesson, greyed with their reasons (worksheets plan v2 T6).
  const types = useQuery(
    lessonWorksheetTypesQuery(client, lesson.id, lesson.generation?.stage, lessonBusy),
  );
  const [picked, setRecipeId] = useState<string | undefined>(intent.intent?.recipeId);
  const typeOptions = types.data ?? [];
  // R4 review (12 Nov): a remembered type the lesson no longer offers (an old id, or one greyed
  // since) is never swapped silently for another: the picker shows no type and says why, and the
  // handoff's auto-request waits for the teacher to choose.
  const asked = picked === undefined ? undefined : offeredTypeOf(picked);
  const unknownPick =
    types.isSuccess && asked !== undefined && !typeOptions.some((t) => t.type === asked);
  const recipeId =
    asked !== undefined
      ? typeOptions.find((t) => t.type === asked)?.type
      : (typeOptions.find((t) => t.available)?.type ?? typeOptions[0]?.type);
  const pickedType = typeOptions.find((t) => t.type === recipeId);
  const [minutes, setMinutes] = useState(String(intent.intent?.practiceMinutes ?? 10));
  const [cooldown, setCooldown] = useState(Date.now() - intent.lastRequestedAt < 30_000);
  const active = list.data?.some((item) => item.generatingJobId) ?? false;
  const activeJob = list.data?.find((item) => item.generatingJobId)?.generatingJobId ?? undefined;
  const stream = useJobEvents(activeJob, client);
  // The job this screen watched (WS2): when it ends, the entry and a toast say how it went.
  const watched = useRef<string | undefined>(undefined);
  if (activeJob) watched.current = activeJob;
  const [justFinished, setJustFinished] = useState(false);
  const [waitingSlot, setWaitingSlot] = useState(false);
  const retry = useMutation(
    sessionMutation(client, {
      mutationFn: (choice: {
        recipeId: string;
        practiceMinutes: number;
        expectedRevision: number;
      }) =>
        requestWorksheetRetryingOnce(client, lesson.id, choice, {
          onWaiting: () => setWaitingSlot(true),
        }),
      onMutate: () => {
        setJustFinished(false);
        intent.lastRequestedAt = Date.now();
        setCooldown(true);
      },
      onError: (error) => toast(error.message),
      onSettled: () => {
        setWaitingSlot(false);
        void list.refetch();
      },
    }),
  );
  const retryLatest = useRef<() => void>(() => {});
  useEffect(() => {
    if (!stream.terminal) return;
    const jobId = watched.current;
    void list.refetch().then(({ data }) => {
      const sheet = data?.find((item) => item.generation?.jobId === jobId);
      if (!sheet || jobId === undefined) return;
      watched.current = undefined;
      const failure = failureMessageOf(sheet);
      if (failure !== null) {
        setJustFinished(false);
        toast("Worksheet didn’t finish", {
          description: failure,
          action: { label: "Try again", onClick: () => retryLatest.current() },
        });
      } else {
        setJustFinished(true);
        toast("Worksheet ready", {
          action: { label: "Open", onClick: () => onOpenWorksheet(sheet.id) },
        });
      }
    });
  }, [stream.terminal, list.refetch, onOpenWorksheet]);
  const request = useMutation(
    sessionMutation(client, {
      mutationFn: (choice: {
        recipeId: string;
        practiceMinutes: number;
        expectedRevision: number;
      }) => requestLessonWorksheet(client, lesson.id, choice),
      onMutate: () => {
        intent.attempted = true;
        intent.pending = true;
        intent.error = null;
        intent.lastRequestedAt = Date.now();
        setCooldown(true);
        persistWorksheetHandoff(client, lesson.id);
      },
      onError: (error) => {
        intent.error = error.message;
        persistWorksheetHandoff(client, lesson.id);
      },
      onSettled: () => {
        intent.pending = false;
        persistWorksheetHandoff(client, lesson.id);
        void list.refetch();
      },
      onSuccess: () => {
        intent.intent = null;
        persistWorksheetHandoff(client, lesson.id);
        setCooldown(true);
      },
    }),
  );
  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => setCooldown(false), 30_000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);
  useEffect(() => {
    if (
      !intent.intent ||
      intent.attempted ||
      !list.isSuccess ||
      active ||
      !canRequestWorksheet(lesson, intent.intent, lessonBusy) ||
      // Post only a type this lesson offers now, the one the picker shows.
      !types.isSuccess ||
      !types.data.some(
        (t) => t.available && t.type === offeredTypeOf(intent.intent?.recipeId ?? ""),
      )
    )
      return;
    // Claim before the async call: remounts and StrictMode cannot enqueue twice. Errors are
    // reconciled by GET above, never automatically retried (the server may have accepted it).
    intent.attempted = true;
    request.mutate(intent.intent);
  }, [
    intent,
    list.isSuccess,
    active,
    lesson,
    lessonBusy,
    types.isSuccess,
    types.data,
    request.mutate,
  ]);
  const changedPlan = !!intent.intent && lesson.plan?.revision !== intent.intent.expectedRevision;
  // A lesson with no recorded stage (made before stages were recorded) still has its plan and
  // facts; the types say whether its slides can carry a sheet.
  const ready = lesson.plan?.state === "confirmed" && !!lesson.facts;
  const entry = worksheetEntryState(list.data, justFinished);
  const failedSheets = list.data?.filter((item) => item.generation?.stage === "failed") ?? [];
  const retrySheet = (item: (typeof failedSheets)[number]) => {
    const choice = retryIntentOf(lesson, item);
    if (choice) retry.mutate(choice);
  };
  retryLatest.current = () => {
    const newest = [...failedSheets].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (newest) retrySheet(newest);
  };
  const retryBlocked = !ready || active || retry.isPending || request.isPending || intent.pending;
  const label = active
    ? WORKSHEET_ENTRY_LABEL.making
    : retry.isPending
      ? WORKSHEET_ENTRY_LABEL.making
      : intent.error
        ? "Check worksheet request"
        : changedPlan
          ? "Review worksheet choice"
          : intent.intent && !intent.attempted
            ? "Worksheet waiting…"
            : WORKSHEET_ENTRY_LABEL[entry];
  useEffect(() => {
    onLabel?.(label);
  }, [label, onLabel]);
  return (
    <>
      {/* The lesson's one Worksheet entry (ruling 186): the list of its sheets, with the maker
          inside. */}
      {trigger ? (
        <Button variant="ghost" size="sm" data-lesson-worksheets onClick={() => onOpenChange(true)}>
          <FileText aria-hidden size={16} strokeWidth={1.5} />
          {label}
        </Button>
      ) : null}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Worksheets</DialogTitle>
          {list.isError ? (
            <p role="alert">
              Could not check your worksheets.{" "}
              <Button variant="link" onClick={() => void list.refetch()}>
                Try again
              </Button>
            </p>
          ) : null}
          {list.data?.map((item) => {
            const failure = failureMessageOf(item);
            return (
              <div
                key={item.id}
                data-worksheet-row={worksheetStatusLabel(item)}
                className="flex flex-col gap-1"
              >
                <div className="flex items-center justify-between gap-3">
                  <Button variant="link" onClick={() => onOpenWorksheet(item.id)}>
                    {item.title}
                  </Button>
                  <span className="text-muted-foreground text-sm">
                    {worksheetStatusLabel(item)}
                  </span>
                </div>
                {failure !== null && !item.generatingJobId ? (
                  <div className="flex items-center justify-between gap-3 pl-1">
                    <p className="text-ink-2 text-sm">{failure}</p>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={retryBlocked}
                      onClick={() => retrySheet(item)}
                    >
                      Try again
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
          {waitingSlot ? (
            <p role="status" className="text-muted-foreground text-sm">
              {TRYING_AGAIN_SHORTLY}
            </p>
          ) : null}
          {intent.error ? (
            <p role="alert">
              {intent.error} Check the list above before trying again; a request may already have
              started.
            </p>
          ) : null}
          {changedPlan ? (
            <p>Your lesson plan changed. Review your worksheet choice before making it.</p>
          ) : null}
          {!ready ? (
            <p>Your lesson needs a confirmed plan before a worksheet can be made.</p>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="worksheet-recipe">Activity type</Label>
            <Select value={recipeId ?? ""} onValueChange={setRecipeId} disabled={!types.isSuccess}>
              <SelectTrigger id="worksheet-recipe">
                <SelectValue placeholder={types.isPending ? "Loading…" : "Choose a type"} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {typeOptions.map((option) => (
                    <SelectItem
                      key={option.type}
                      value={option.type}
                      disabled={!option.available}
                      data-sheet-type={option.type}
                    >
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {types.isPending ? (
              <p role="status" className="text-muted-foreground text-sm" data-sheet-types-loading>
                Loading the worksheet types for this lesson…
              </p>
            ) : null}
            {types.isError ? (
              <p role="alert" className="text-sm" data-sheet-types-error>
                Couldn’t load the worksheet types.{" "}
                <Button variant="link" onClick={() => void types.refetch()}>
                  Try again
                </Button>
              </p>
            ) : null}
            {unknownPick ? (
              <p className="text-ink-2 text-sm" data-sheet-type-unknown>
                The type you chose before isn’t offered for this lesson. Choose one to make.
              </p>
            ) : null}
            {pickedType && !pickedType.available ? (
              <p className="text-ink-2 text-sm" data-sheet-type-reason>
                {pickedType.reason}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="worksheet-minutes">Practice time</Label>
            <Select value={minutes} onValueChange={setMinutes}>
              <SelectTrigger id="worksheet-minutes">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {[5, 10, 15, 20, 30, 45].map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      About {value} minutes
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={
              !ready ||
              !list.isSuccess ||
              !types.isSuccess ||
              active ||
              cooldown ||
              request.isPending ||
              intent.pending ||
              recipeId === undefined ||
              pickedType?.available !== true
            }
            onClick={() =>
              recipeId !== undefined &&
              request.mutate({
                recipeId,
                practiceMinutes: Number(minutes),
                expectedRevision: lesson.plan?.revision ?? 0,
              })
            }
          >
            {list.data?.length ? "Make another worksheet" : "Make a worksheet"}
          </Button>
          {cooldown && !active ? (
            <p className="text-muted-foreground text-sm">
              You can request another worksheet shortly.
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
