import type { JobEvent } from "@tj/domain/jobs";
import { useEffect, useState } from "react";
import {
  currentStageHighMs,
  type EstimateHistory,
  type EstimateRange,
  estimateRemaining,
  estimateText,
  narrowRange,
  stagePositionOf,
  TAKING_LONGER_TEXT,
} from "@/lib/generation-estimate";

/**
 * The time-left line for the generating view's top bar (TEACH-201, PRD section 4). Reads the
 * job's events and the per-stage history and says "About 2 to 3 minutes left", or nothing when
 * there is nothing honest to say (thin history, under 20 seconds, the run is over).
 *
 * The text changes only when an event arrives: the reading is taken then and left alone. A
 * reading may move either way when a new fact arrives (the outline's slide count replacing the
 * brief's, a stage boundary); on the same facts it only narrows. One timer per event flips it to
 * "Taking longer than usual" when the stage's high bound passes with no new event; the next
 * event, whatever it says, clears it and takes a fresh reading. Nothing ticks.
 *
 * Renders nothing rather than an empty element, so the bar's gap does not open for it. Wired
 * into `GeneratingShell`'s `estimate` slot (TEACH-199) once both land.
 */
export function EstimateText({
  history,
  events,
  slides,
  clock = Date.now,
}: {
  history: EstimateHistory | null | undefined;
  events: readonly JobEvent[];
  /** Slides the brief asked for; the outline's "Slide n of N" takes over once it lands. */
  slides: number;
  /** Injectable for tests; read once per event, never on a tick. */
  clock?: () => number;
}) {
  const [reading, setReading] = useState<Reading>(NO_READING);
  const position = stagePositionOf(events);
  // The facts a reading rests on: the stage, the slides written and the outline's total. Two
  // readings on the same facts may only narrow; a new fact may move the range either way.
  const facts = position
    ? `${position.stage}:${position.slide?.n ?? 0}/${position.slide?.total ?? slides}:${position.since}`
    : "";
  const lastAt = events.at(-1)?.at ?? "";
  const ended = events.length === 0 || position === null || position.stage === "ready";
  // The bound the late timer waits for; a number, so the history object's identity is moot.
  const high = ended ? null : currentStageHighMs(history, events);

  // `events`, `position` and `history` change identity freely; the keys below are what matter.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the last event and the facts
  useEffect(() => {
    if (ended) {
      setReading(NO_READING);
      return;
    }
    const now = clock();
    setReading((previous) => {
      const next = estimateRemaining(history, events, now, { slides });
      const range =
        next === null ? null : previous.facts === facts ? narrowRange(previous.range, next) : next;
      return { range, facts, late: false };
    });
    if (high === null || position === null) return;
    const remaining = Date.parse(position.since) + high - now;
    const timer = window.setTimeout(
      () => setReading((previous) => ({ ...previous, late: true })),
      Math.max(0, remaining),
    );
    return () => window.clearTimeout(timer);
  }, [lastAt, facts, ended, high, slides, clock]);

  if (reading.late) {
    return (
      <span data-testid="generation-estimate" data-state="late" className="text-ink-3 text-meta">
        {TAKING_LONGER_TEXT}
      </span>
    );
  }
  const text = estimateText(reading.range);
  if (text === null) return null;
  return (
    <span data-testid="generation-estimate" data-state="range" className="text-ink-3 text-meta">
      {text}
    </span>
  );
}

interface Reading {
  range: EstimateRange | null;
  /** The facts key the range was read on; see `facts` above. */
  facts: string;
  late: boolean;
}

const NO_READING: Reading = { range: null, facts: "", late: false };
