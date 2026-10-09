/**
 * The library's draw in its own thread (TEACH-247 part h, ADR 0035): `guard.ts` starts one per
 * drawing and ends it after the answer or at the deadline, so a model that loops or grows can never
 * hold the worker's event loop, and nothing it allocates outlives the drawing. Built for the worker
 * image as `dist/library-render-worker.js` (apps/worker `build`).
 */
import { kit, renderLibraryModel } from "./render";
import type { J } from "./types";

declare const self: Worker;
type Job = { id: string; params: J; step?: number };

await kit();
self.onmessage = async (e: MessageEvent<Job>) => {
  const { id, params, step } = e.data;
  const answer = await renderLibraryModel(id, params, step === undefined ? {} : { step }).then(
    (drawing) => ({ type: "done" as const, drawing }),
    (err: unknown) => ({ type: "error" as const, message: String(err).slice(0, 300) }),
  );
  self.postMessage(answer);
};
self.postMessage({ type: "ready" });
