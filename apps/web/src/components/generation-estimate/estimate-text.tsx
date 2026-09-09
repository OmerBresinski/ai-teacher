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
 * The text changes only when an event arrives: the reading is taken then, narrowed against the
 * one before it, and left alone. One timer per event flips it to "Taking longer than usual" when
 * the stage's high bound passes with no new event; the next event clears it. Nothing ticks.
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
  // The stage's own clock starts at the event that opened it; a message-only tick within the same
  // stage changes neither, so only a move keys a fresh reading.
  const position = stagePositionOf(events);
  const positionKey = position
    ? `${position.stage}:${position.slide?.n ?? 0}:${position.since}`
    : "";
  const ended = events.length === 0 || position === null || position.stage === "ready";

  // `events` and `position` change identity on every render; the stage key is what matters.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the stage move, not the arrays
  useEffect(() => {
    if (ended) {
      setReading(NO_READING);
      return;
    }
    const now = clock();
    setReading((previous) => {
      const next = estimateRemaining(history, events, now, { slides });
      const range = next === null ? null : narrowRange(previous.range, next);
      return { range, late: false };
    });
    const high = currentStageHighMs(history, events);
    if (high === null || position === null) return;
    const remaining = Date.parse(position.since) + high - now;
    const timer = window.setTimeout(
      () => setReading((previous) => ({ ...previous, late: true })),
      Math.max(0, remaining),
    );
    return () => window.clearTimeout(timer);
  }, [positionKey, ended, history, slides, clock]);

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
  late: boolean;
}

const NO_READING: Reading = { range: null, late: false };
