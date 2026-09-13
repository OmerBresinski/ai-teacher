import "@/styles.css";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { sessionBoundary } from "@/lib/session-boundary";
import { sessionRouter, startSessionRuntime } from "@/lib/session-runtime";
import { startSpeedInsights } from "@/lib/speed-insights";

const stopSessionRuntime = startSessionRuntime();
import.meta.hot?.dispose(stopSessionRuntime);

function SessionApp() {
  const { epoch } = useSyncExternalStore(sessionBoundary.subscribe, sessionBoundary.getSnapshot);
  return <RouterProvider key={epoch} router={sessionRouter} />;
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error('index.html is missing <div id="root">');

createRoot(rootElement).render(
  <StrictMode>
    <SessionApp />
  </StrictMode>,
);

// Production only; a no-op (and tree-shaken) in preview/development builds.
let stopInsights = () => {};
let insightsEpoch = -1;
function bindInsights() {
  const epoch = sessionBoundary.getSnapshot().epoch;
  if (insightsEpoch === epoch) return;
  insightsEpoch = epoch;
  stopInsights();
  void startSpeedInsights(sessionRouter).then((stop) => {
    if (sessionBoundary.getSnapshot().epoch !== epoch) stop();
    else stopInsights = stop;
  });
}
bindInsights();
const stopWatchingInsights = sessionBoundary.subscribe(bindInsights);
import.meta.hot?.dispose(() => {
  stopWatchingInsights();
  stopInsights();
});
