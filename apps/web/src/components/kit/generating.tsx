import type { Lesson } from "@tj/domain/documents";
import type { JobEvent } from "@tj/domain/jobs";
import { demoWorkspace } from "@tj/editor/starter";
import { Button, Tabs, TabsList, TabsTrigger } from "@tj/ui";
import { Pause, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { GeneratingShell } from "@/components/generating-lesson";
import { bodyAt, generationRun, RUN_STATES, runEvents, withTerminal } from "@/test/play-run";
import { Specimen } from "./frame";

/*
 * The generating shell on the recorded run (generating-state PRD §7): a state picker for each
 * point of the run, Play to step through the rows at the recorded pace and a speed control. The
 * demo and the visual test surface; the page itself is `/l/:id` under a lock.
 */

type RunState = keyof typeof RUN_STATES | "failed" | "cancelled";

const STATE_LABELS: Record<RunState, string> = {
  planning: "Planning",
  writing: "Writing",
  worksheet: "Worksheet",
  pictures: "Pictures",
  checking: "Checking",
  ready: "Ready",
  failed: "Failed",
  cancelled: "Cancelled",
};

const SPEEDS = [
  { value: "1", label: "1x" },
  { value: "4", label: "4x" },
  { value: "16", label: "16x" },
] as const;

function demoLesson(): Lesson {
  const found = demoWorkspace(new Date()).find((d) => d.key === generationRun.lesson);
  if (!found || !("slides" in found.body)) throw new Error("demo lesson missing");
  return found.body;
}

export function GeneratingExhibit() {
  const lesson = useMemo(demoLesson, []);
  const [state, setState] = useState<RunState>("writing");
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]["value"]>("4");
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState<number>(RUN_STATES.writing);

  // Play steps the cursor through the rows at the recorded offsets, scaled by the speed.
  useEffect(() => {
    if (!playing) return;
    const rows = generationRun.events;
    if (cursor >= rows.length) {
      setPlaying(false);
      return;
    }
    const previous = rows[cursor - 1]?.offsetMs ?? 0;
    const wait = Math.max(0, ((rows[cursor]?.offsetMs ?? 0) - previous) / Number(speed));
    const timer = window.setTimeout(() => setCursor((c) => c + 1), wait);
    return () => window.clearTimeout(timer);
  }, [playing, cursor, speed]);

  const pick = (next: RunState) => {
    setState(next);
    setPlaying(false);
    setCursor(
      next === "failed" || next === "cancelled" ? RUN_STATES.writing + 1 : RUN_STATES[next],
    );
  };

  const events: JobEvent[] =
    state === "failed" || state === "cancelled"
      ? withTerminal(generationRun, cursor, state)
      : runEvents(generationRun, cursor);
  const body = bodyAt(generationRun, Math.max(0, cursor - 1), lesson);

  return (
    <Specimen
      name="Generating"
      note="The editor's shell while a lesson is written: the stage line and Stop in the bar, the five-stage strip, the rail empty, the newest slide on the canvas and the lock line under it. Pick a point in the recorded run or play it."
      bleed
    >
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <Tabs value={state} onValueChange={(value) => pick(value as RunState)}>
          <TabsList aria-label="Run state">
            {(Object.keys(STATE_LABELS) as RunState[]).map((id) => (
              <TabsTrigger key={id} value={id}>
                {STATE_LABELS[id]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (!playing && cursor >= generationRun.events.length) setCursor(0);
              setPlaying((p) => !p);
            }}
            disabled={state === "failed" || state === "cancelled"}
          >
            {playing ? (
              <Pause aria-hidden size={14} strokeWidth={1.5} />
            ) : (
              <Play aria-hidden size={14} strokeWidth={1.5} />
            )}
            {playing ? "Pause" : "Play"}
          </Button>
          <Tabs value={speed} onValueChange={(value) => setSpeed(value as typeof speed)}>
            <TabsList aria-label="Speed">
              {SPEEDS.map((s) => (
                <TabsTrigger key={s.value} value={s.value}>
                  {s.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <span className="text-meta text-ink-3 tabular-nums">
            Row {Math.min(cursor, generationRun.events.length)} of {generationRun.events.length}
          </span>
        </div>
      </div>
      <div className="w-full overflow-hidden rounded-card border border-border">
        <GeneratingShell
          lesson={body}
          events={events}
          estimate={
            state === "writing" || state === "worksheet" ? "About 1 to 2 minutes left" : undefined
          }
          onBack={() => undefined}
          onStop={() => pick("cancelled")}
          className="h-[640px]"
        />
      </div>
    </Specimen>
  );
}
