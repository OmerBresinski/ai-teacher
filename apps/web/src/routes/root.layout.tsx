import { QueryClientProvider } from "@tanstack/react-query";
import { Outlet, useRouteContext } from "@tanstack/react-router";
import { ThemeProvider } from "@tj/ui";
import { lazy, Suspense } from "react";

/**
 * Devtools are DEV-only dynamic imports so they never reach the production bundle
 * (`import.meta.env.DEV` is statically false in `vite build`, so Rolldown drops the chunks).
 */
const Devtools = import.meta.env.DEV
  ? lazy(() => import("@/components/devtools").then((m) => ({ default: m.Devtools })))
  : () => null;

export function RootLayout() {
  const { queryClient } = useRouteContext({ from: "__root__" });
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Outlet />
        <Suspense fallback={null}>
          <Devtools />
        </Suspense>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
