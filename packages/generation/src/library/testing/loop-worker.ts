// A draw thread that never answers (guard.test.ts): it loads, then loops forever on the job.
declare const self: Worker;
self.onmessage = () => {
  for (;;) {}
};
self.postMessage({ type: "ready" });
