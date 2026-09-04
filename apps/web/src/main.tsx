import "@/styles.css";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { startSpeedInsights } from "@/lib/speed-insights";
import { router } from "@/router";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error('index.html is missing <div id="root">');

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

// Production only; a no-op (and tree-shaken) in preview/development builds.
void startSpeedInsights(router);
