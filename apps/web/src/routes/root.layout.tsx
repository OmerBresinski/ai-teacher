import { Outlet } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

/**
 * Root route component: just the outlet. App-wide providers (`QueryClientProvider`,
 * `ThemeProvider`) live in the router's `Wrap` option (`src/router.tsx`) so the root
 * `errorComponent` / `notFoundComponent`, which replace this component, still get them.
 *
 * Devtools are DEV-only dynamic imports so they never reach the production bundle
 * (`import.meta.env.DEV` is statically false in `vite build`, so Rolldown drops the chunks).
 */
const Devtools = import.meta.env.DEV
  ? lazy(() => import("@/components/devtools").then((m) => ({ default: m.Devtools })))
  : () => null;

export function RootLayout() {
  return (
    <>
      <Outlet />
      <Suspense fallback={null}>
        <Devtools />
      </Suspense>
    </>
  );
}
