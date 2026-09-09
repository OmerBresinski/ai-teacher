/**
 * A recorded `lesson.plan` run, replayed (generating-state PRD §7). `generation-run.json` holds the
 * `job_events` rows of one fake-worker run with, per row, how much of the lesson the worker had
 * persisted. `playRun` emits each event through a `FakeEventSource` at its recorded offset
 * (scaled by `speed`; `0` is all at once, the reload case) and hands the matching body to
 * `persist` before any event that carries a `documentUpdatedAt`, so the fake API answers the
 * refetch with what the worker would have written. Truncating with `upTo` gives every
 * intermediate state; `withTerminal` appends a `failed` or `cancelled` row for the stopped states.
 */
import type { Lesson, LessonFacts, OutlineEntry } from "@tj/domain/documents";
import { type JobEvent, JobEventSchema, type JobProgress } from "@tj/domain/jobs";
import { FakeEventSource } from "./fake-event-source";
import recorded from "./fixtures/generation-run.json";

export interface RunEventRow {
  offsetMs: number;
  type: "queued" | "started" | "progress" | "completed";
  progress?: JobProgress;
  /** Slides on the row when the event was emitted, as a prefix of the demo lesson. */
  slides: number;
  /** Whether Plan's outline (`facts`) was on the row. */
  facts: boolean;
}

export interface RunFixture {
  lesson: string;
  jobId: string;
  workspaceId: string;
  startedAt: string;
  events: RunEventRow[];
}

export const generationRun: RunFixture = recorded as RunFixture;

/**
 * How many rows to replay (`upTo`, exclusive) to land the run on each of the shell's stages: the
 * count that includes the first row of that stage. `runEvent(fixture, RUN_UP_TO.checking - 1)`
 * is the row that starts Checking.
 */
export const RUN_UP_TO = {
  planning: 3,
  writing: 6,
  worksheet: 11,
  pictures: 12,
  checking: 13,
  ready: 15,
} as const;

export function runEvent(fixture: RunFixture, index: number): JobEvent {
  const row = fixture.events[index];
  if (!row) throw new Error(`no event ${index} in the run`);
  const at = new Date(new Date(fixture.startedAt).getTime() + row.offsetMs).toISOString();
  const base = { jobId: fixture.jobId, workspaceId: fixture.workspaceId, at };
  // Parsed, not cast: the fixture is checked against the contract every time it is replayed.
  return JobEventSchema.parse(
    row.type === "progress"
      ? { type: "progress", ...base, progress: row.progress ?? {} }
      : { type: row.type, ...base },
  );
}

/** The run's events as `JobEvent`s, the first `upTo` of them (all by default). */
export function runEvents(fixture: RunFixture, upTo = fixture.events.length): JobEvent[] {
  return fixture.events.slice(0, upTo).map((_, i) => runEvent(fixture, i));
}

/** A stopped run: the events so far and then the terminal row. */
export function withTerminal(
  fixture: RunFixture,
  upTo: number,
  type: "failed" | "cancelled",
  message = "The model timed out.",
): JobEvent[] {
  const events = runEvents(fixture, upTo);
  const last = fixture.events[Math.max(0, upTo - 1)];
  const at = new Date(
    new Date(fixture.startedAt).getTime() + (last?.offsetMs ?? 0) + 100,
  ).toISOString();
  const base = { jobId: fixture.jobId, workspaceId: fixture.workspaceId, at };
  events.push(
    JobEventSchema.parse(
      type === "failed"
        ? { type, ...base, error: { message, retryable: true } }
        : { type, ...base },
    ),
  );
  return events;
}

/** The lesson body the worker had persisted by row `index`: the slides so far, the outline once Plan wrote it. */
export function bodyAt(fixture: RunFixture, index: number, full: Lesson): Lesson {
  const row = fixture.events[Math.min(index, fixture.events.length - 1)];
  const slides = full.slides.slice(0, row?.slides ?? 0);
  const body: Lesson = { ...full, slides };
  // The outline is one entry per slide of the run, whatever the seeded facts say, so the
  // placeholders count down to exactly the slides that arrive.
  if (row?.facts)
    body.facts = { ...(full.facts ?? outlineFacts(full)), outline: outlineFacts(full).outline };
  else delete body.facts;
  return body;
}

/** Plan's outline for a lesson that has none stored: one entry per slide, in order. */
export function outlineFacts(full: Lesson): LessonFacts {
  const minutes = Math.max(1, Math.round(60 / Math.max(1, full.slides.length)));
  return {
    objectives: [],
    vocabulary: [],
    workedExamples: [],
    questions: [],
    misconceptions: [],
    outline: full.slides.map((slide, i) => ({
      id: `s${i + 1}`,
      // The demo lessons use outline kinds only; a slide kind Plan never plans is not seeded.
      kind: slide.kind as OutlineEntry["kind"],
      minutes,
      factRefs: [],
    })),
    durationMin: minutes * full.slides.length,
  };
}

/**
 * The gap before row `index` at `speed` (0 for the first row): one schedule for `playRun` and
 * the kit exhibit.
 */
export function waitBefore(fixture: RunFixture, index: number, speed: number): number {
  if (index <= 0 || speed <= 0) return 0;
  const previous = fixture.events[index - 1]?.offsetMs ?? 0;
  return Math.max(0, ((fixture.events[index]?.offsetMs ?? 0) - previous) / speed);
}

export interface PlayRunOptions {
  /** Playback rate: `1` is the recorded pace, `4` four times as fast, `0` everything at once. */
  speed?: number;
  /** Emit rows `from` (0 by default) up to, not including, `upTo`. */
  from?: number;
  upTo?: number;
  /** The stream to emit on; the newest `FakeEventSource` by default. */
  source?: FakeEventSource;
  /** Receives the body the worker persisted, before the event that announces it. */
  persist?: (body: Lesson, index: number) => void;
  /** The finished lesson the bodies are sliced from; needed when `persist` is given. */
  lesson?: Lesson;
}

export interface PlayRunHandle {
  /** Resolves once the last row has been emitted (or `stop` was called). */
  done: Promise<void>;
  stop: () => void;
}

export function playRun(fixture: RunFixture, options: PlayRunOptions = {}): PlayRunHandle {
  const { speed = 0, from = 0, upTo = fixture.events.length } = options;
  const source = options.source ?? FakeEventSource.latest;
  const rows = fixture.events
    .slice(0, upTo)
    .map((row, index) => ({ row, index }))
    .slice(from);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const emit = (position: number) => {
    const entry = rows[position];
    if (!entry) return;
    const { row, index } = entry;
    if (options.persist && options.lesson && row.progress?.documentUpdatedAt !== undefined) {
      options.persist(bodyAt(fixture, index, options.lesson), index);
    }
    source.emit(row.type, runEvent(fixture, index), String(index + 1));
  };

  if (speed <= 0) {
    for (let i = 0; i < rows.length; i++) emit(i);
    return { done: Promise.resolve(), stop: () => undefined };
  }

  let resolveDone: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const schedule = (index: number) => {
    if (stopped || index >= rows.length) {
      resolveDone();
      return;
    }
    // A run continued with `from` waits the gap since the previous row, not its absolute offset.
    const wait = waitBefore(fixture, rows[index]?.index ?? 0, speed);
    timer = setTimeout(() => {
      emit(index);
      schedule(index + 1);
    }, wait);
  };
  schedule(0);

  return {
    done,
    stop: () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      resolveDone();
    },
  };
}
