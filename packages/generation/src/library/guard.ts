/**
 * A library drawing with a deadline (TEACH-247 part h, ADR 0035). The kit draws synchronously, so
 * the draw runs in a worker thread (`render-worker.ts`) that is ended when it answers, when it
 * misses the deadline, or when it fails; the caller then falls back to the drawer. One thread is
 * shared and its drawings run one at a time (one DOM, reused); it is replaced after a missed
 * deadline or a fault, and every RECYCLE_AFTER drawings, so its memory can't grow without end.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { LibraryDrawing } from "./render";
import type { J } from "./types";

/** How long a drawing may take once its thread has loaded the kit and the model. */
export const DRAW_DEADLINE_MS = 3_000;
/** How long a thread may take to load (cold: happy-dom, the kit, one model). */
export const LOAD_DEADLINE_MS = 15_000;

/** The draw thread's entry: the worker image's built file beside its bundle, else the source. */
export function renderWorkerUrl(): string {
  const built = new URL("./library-render-worker.js", import.meta.url);
  if (built.protocol === "file:" && existsSync(fileURLToPath(built))) return built.href;
  return new URL("./render-worker.ts", import.meta.url).href;
}

/** Drawings one thread makes before a fresh one replaces it. */
export const RECYCLE_AFTER = 40;

type Answer =
  | { type: "ready" }
  | { type: "done"; drawing: LibraryDrawing }
  | { type: "error"; message: string };

type Thread = { worker: Worker; url: string; ready: Promise<void>; drawings: number };
let shared: Thread | undefined;
let queue: Promise<unknown> = Promise.resolve();

function retire(t: Thread) {
  t.worker.terminate();
  if (shared === t) shared = undefined;
}

function thread(url: string, loadMs: number): Thread {
  if (shared && shared.url === url && shared.drawings < RECYCLE_AFTER) return shared;
  if (shared) retire(shared);
  const worker = new Worker(url);
  const t: Thread = { worker, url, drawings: 0, ready: Promise.resolve() };
  t.ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      retire(t);
      reject(new Error(`the draw thread missed its ${loadMs} ms load deadline`));
    }, loadMs);
    worker.onerror = (e) => {
      clearTimeout(timer);
      retire(t);
      reject(new Error(`the draw thread failed to load: ${e.message}`));
    };
    worker.onmessage = (e: MessageEvent<Answer>) => {
      if (e.data.type !== "ready") return;
      clearTimeout(timer);
      resolve();
    };
  });
  shared = t;
  return t;
}

async function drawOne(
  id: string,
  params: J,
  opts: { step?: number },
  limits: { drawMs?: number; loadMs?: number; workerUrl?: string },
): Promise<LibraryDrawing> {
  const t = thread(limits.workerUrl ?? renderWorkerUrl(), limits.loadMs ?? LOAD_DEADLINE_MS);
  await t.ready;
  t.drawings++;
  const ms = limits.drawMs ?? DRAW_DEADLINE_MS;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      retire(t);
      reject(new Error(`${id}: draw missed its ${ms} ms deadline`));
    }, ms);
    t.worker.onerror = (e) => {
      clearTimeout(timer);
      retire(t);
      reject(new Error(`${id}: ${e.message}`));
    };
    t.worker.onmessage = (e: MessageEvent<Answer>) => {
      const a = e.data;
      if (a.type === "ready") return;
      clearTimeout(timer);
      if (a.type === "done") resolve(a.drawing);
      else reject(new Error(a.message));
    };
    t.worker.postMessage({ id, params, ...(opts.step === undefined ? {} : { step: opts.step }) });
  });
}

/** Draws model `id` on the shared draw thread; rejects on a fault, a load miss or the deadline. */
export function drawLibraryModel(
  id: string,
  params: J,
  opts: { step?: number } = {},
  limits: { drawMs?: number; loadMs?: number; workerUrl?: string } = {},
): Promise<LibraryDrawing> {
  const run = queue.then(() => drawOne(id, params, opts, limits));
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Ends the shared draw thread (tests, shutdown). */
export function endDrawThread() {
  if (shared) retire(shared);
}
