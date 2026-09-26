import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Lesson } from "@tj/domain/documents";
import { WORKSHEET_RECIPES } from "@tj/editor/worksheet-editor";
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
} from "@tj/ui";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useJobEvents } from "@/hooks/use-job-events";
import {
  canRequestWorksheet,
  generationHandoff,
  lessonWorksheetsQuery,
  persistWorksheetHandoff,
  requestLessonWorksheet,
  subscribeWorksheetHandoff,
  worksheetHandoffSnapshot,
} from "@/lib/lesson-worksheets";
import { sessionMutation } from "@/lib/session-boundary";

/** Independent worksheet jobs never keep the slide editor locked. */
export function LessonWorksheets({
  lesson,
  open,
  onOpenChange,
  onOpenWorksheet,
}: {
  lesson: Lesson;
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
  const [recipeId, setRecipeId] = useState(intent.intent?.recipeId ?? "auto");
  const [minutes, setMinutes] = useState(String(intent.intent?.practiceMinutes ?? 10));
  const [cooldown, setCooldown] = useState(Date.now() - intent.lastRequestedAt < 30_000);
  const active = list.data?.some((item) => item.generatingJobId) ?? false;
  const activeJob = list.data?.find((item) => item.generatingJobId)?.generatingJobId ?? undefined;
  const stream = useJobEvents(activeJob, client);
  useEffect(() => {
    if (stream.terminal) void list.refetch();
  }, [stream.terminal, list.refetch]);
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
      !canRequestWorksheet(lesson, intent.intent)
    )
      return;
    // Claim before the async call: remounts and StrictMode cannot enqueue twice. Errors are
    // reconciled by GET above, never automatically retried (the server may have accepted it).
    intent.attempted = true;
    request.mutate(intent.intent);
  }, [intent, list.isSuccess, active, lesson, request.mutate]);
  const ready = lesson.plan?.state === "confirmed" && !!lesson.generation && !!lesson.facts;
  const changedPlan = !!intent.intent && lesson.plan?.revision !== intent.intent.expectedRevision;
  const label = active
    ? "Worksheet generating…"
    : intent.error
      ? "Check worksheet request"
      : changedPlan
        ? "Review worksheet choice"
        : intent.intent && !intent.attempted
          ? "Worksheet waiting…"
          : "Worksheets";
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => onOpenChange(true)}>
        {label}
      </Button>
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
          {list.data?.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3">
              <Button variant="link" onClick={() => onOpenWorksheet(item.id)}>
                {item.title}
              </Button>
              <span className="text-muted-foreground text-sm">
                {item.generatingJobId
                  ? "Generating…"
                  : item.generation?.completedAt
                    ? "Ready"
                    : "Incomplete"}
              </span>
            </div>
          ))}
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
            <Select value={recipeId} onValueChange={setRecipeId}>
              <SelectTrigger id="worksheet-recipe">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="auto">Suggested for this lesson</SelectItem>
                  {WORKSHEET_RECIPES.map((recipe) => (
                    <SelectItem key={recipe.id} value={recipe.id}>
                      {recipe.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
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
              !ready || !list.isSuccess || active || cooldown || request.isPending || intent.pending
            }
            onClick={() =>
              request.mutate({
                recipeId,
                practiceMinutes: Number(minutes),
                expectedRevision: lesson.plan?.revision ?? 0,
              })
            }
          >
            {list.data?.length ? "Add another worksheet" : "Make worksheet"}
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
