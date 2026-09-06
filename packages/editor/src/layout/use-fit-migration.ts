import type { Id, Lesson, Theme } from "@tj/domain/documents";
import { useEffect, useRef } from "react";
import * as reducers from "../model/reducers";
import { getTheme } from "../model/themes";
import {
  fitMigrationMessage,
  measureInputsOf,
  planFitMigration,
  renderedHeights,
} from "./fit-plan";
import { lintSlide } from "./lint";
import { createMeasurer, warmMeasurer, whenFontsReady } from "./measure";
import type { MeasureInput, Measurer } from "./reflow";
import { tidySlideReducer } from "./tidy";

/**
 * Text fitting engine — the migration, bound to the editor (TeachDeck `use-fit-migration.ts`).
 *
 * `./fit-plan.ts` decides *what* to re-fit; this is the half that needs a browser. It runs once
 * per lesson, in the editor, and:
 *
 * 1. warms the ruler for the whole deck in one batch, then lints every slide as the renderer will
 *    draw it;
 * 2. tidies the flagged ones inside one transaction, so a teacher's undo returns the lesson to the
 *    layout they arrived with in a single press;
 * 3. stamps the lesson with the current `FIT_VERSION` before that transaction opens and without an
 *    undo entry (`setFitVersion` is silent), so undo restores the layout and leaves the stamp;
 * 4. says so, once, when a slide actually moved.
 *
 * **It waits for the teacher.** It runs only when nothing is being edited, nothing is selected and
 * no transaction is open; otherwise it tries again on the next idle callback a few times and then
 * gives up quietly for this session — the lesson stays unstamped and is migrated next open.
 */

export type FitMigrationOutcome = {
  /** True when the lesson was behind and has now been stamped. */
  ran: boolean;
  /** How many slides the tidy actually changed. */
  tidied: number;
  /** Set when the run was put off because the teacher was in the middle of something. */
  deferred?: boolean;
};

const NOT_RUN: FitMigrationOutcome = { ran: false, tidied: 0 };

/** What the migration needs from the editor: the document, its history, and whether it is quiet. */
export type FitMigrationDeps = {
  lesson: Lesson;
  dispatch: <R extends (lesson: Lesson, ...args: never[]) => unknown>(
    reducer: R,
    ...args: R extends (lesson: Lesson, ...rest: infer A) => unknown ? A : never
  ) => ReturnType<R> | undefined;
  beginTransaction: () => number;
  endTransaction: (token?: number) => void;
  /** False puts the run off: something of the teacher's is in flight. */
  isIdle: () => boolean;
  /** Injected in tests; the defaults are the DOM ruler. */
  measurer?: (theme: Theme) => Measurer;
  warm?: (inputs: MeasureInput[], theme: Theme) => void;
};

/**
 * Re-fit the open lesson if its layout predates the current floors. Safe to call on a lesson that
 * is up to date: it reads one number and writes nothing.
 */
export function runFitMigration(deps: FitMigrationDeps): FitMigrationOutcome {
  const { lesson, dispatch, isIdle, measurer = createMeasurer, warm = warmMeasurer } = deps;
  // The cheap half first: a lesson at the current version costs one comparison.
  const dry = planFitMigration(lesson, () => false);
  if (!dry.needed) return NOT_RUN;

  // Ask whether the editor is quiet before measuring anything.
  if (!isIdle()) return { ran: false, tidied: 0, deferred: true };

  const theme = getTheme(lesson.themeId);
  const measure = measurer(theme);

  // One forced layout for the whole deck rather than one per box.
  warm(
    lesson.slides.flatMap((slide) => measureInputsOf(slide)),
    theme,
  );

  const plan = planFitMigration(
    lesson,
    // Linted as the renderer draws it, not as it is stored.
    (slide) => !lintSlide(renderedHeights(slide, measure), measure, theme).ok,
  );
  // Stamped first, and outside the undo history: written before the transaction it is inside the
  // snapshot the transaction restores, so undo gives the teacher their layout back while the app
  // keeps the fact that it has looked.
  dispatch(reducers.setFitVersion, plan.version);

  let tidied = 0;
  const token = deps.beginTransaction();
  try {
    for (const id of plan.slideIds) {
      const made = dispatch(tidySlideReducer, id, measure);
      if (made?.outcome.changed) tidied += 1;
    }
  } finally {
    deps.endTransaction(token);
  }

  return { ran: true, tidied };
}

/** How many idle callbacks the migration will wait for the teacher to be still. */
export const MAX_ATTEMPTS = 5;

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const idle = (cb: () => void): number => {
  const w = window as IdleWindow;
  return w.requestIdleCallback ? w.requestIdleCallback(cb) : window.setTimeout(cb, 120);
};

const cancelIdle = (handle: number) => {
  const w = window as IdleWindow;
  if (w.cancelIdleCallback) w.cancelIdleCallback(handle);
  else window.clearTimeout(handle);
};

/**
 * One run per lesson id, and one only. `claim` takes the id; `release` gives it back, so an effect
 * torn down before the fonts settle (React's development double mount) does not swallow the only
 * run.
 */
export function createRunGate() {
  let held: Id | null = null;
  return {
    claim(id: Id): boolean {
      if (held === id) return false;
      held = id;
      return true;
    },
    release(id: Id): void {
      if (held === id) held = null;
    },
    held: (): Id | null => held,
  };
}

export type UseFitMigrationOptions = {
  lessonId: Id | null | undefined;
  /** The latest deps, read at run time (the lesson moves on while fonts load). */
  getDeps: () => FitMigrationDeps | null;
  /** Shown once, when a slide actually moved. */
  notify: (message: string) => void;
  /** Injected in tests. */
  fontsReady?: () => Promise<void>;
};

/** Run the migration once, after mount, for the lesson the editor has open. */
export function useFitMigration({
  lessonId,
  getDeps,
  notify,
  fontsReady = whenFontsReady,
}: UseFitMigrationOptions): void {
  const gate = useRef<ReturnType<typeof createRunGate> | undefined>(undefined);
  gate.current ??= createRunGate();
  const getDepsRef = useRef(getDeps);
  getDepsRef.current = getDeps;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const fontsRef = useRef(fontsReady);
  fontsRef.current = fontsReady;

  useEffect(() => {
    const run = gate.current;
    if (!lessonId || !run?.claim(lessonId)) return;
    let cancelled = false;
    let handle = 0;
    let attempts = 0;

    const attempt = () => {
      if (cancelled) return;
      const deps = getDepsRef.current();
      // The cache may have moved on while the fonts loaded.
      if (!deps || deps.lesson.id !== lessonId) return;
      const { tidied, deferred } = runFitMigration(deps);
      if (deferred && ++attempts < MAX_ATTEMPTS) {
        handle = idle(attempt);
        return;
      }
      if (tidied > 0) notifyRef.current(fitMigrationMessage(tidied));
    };

    void fontsRef.current().then(() => {
      if (!cancelled) attempt();
    });

    return () => {
      cancelled = true;
      if (handle) cancelIdle(handle);
      run.release(lessonId);
    };
  }, [lessonId]);
}
