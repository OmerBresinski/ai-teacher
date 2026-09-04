/**
 * Vercel Speed Insights (ADR 0010, TEACH-25) — web-vitals per route, production only.
 *
 * The guard reads `import.meta.env.VITE_APP_ENV` *directly* (not the Zod-parsed `env`): Vite
 * inlines the literal at build time, so in preview/development builds the whole branch — and the
 * dynamic `import("@vercel/speed-insights")` chunk — is dead code and never reaches `dist/`.
 * `VITE_APP_ENV` is therefore also a turbo cache input (`turbo.json`, `@tj/web#build.env`).
 *
 * The reported `route` is the matched route *pattern* (`/things/$id`), never the concrete
 * pathname, so ids and search params do not leave the browser.
 */
import type { AnyRouter } from "@tanstack/react-router";

function currentRoutePattern(router: AnyRouter): string | null {
  const last = router.state.matches.at(-1);
  return typeof last?.fullPath === "string" ? last.fullPath : null;
}

export async function startSpeedInsights(router: AnyRouter): Promise<void> {
  if (import.meta.env.VITE_APP_ENV !== "production") return;
  const { injectSpeedInsights } = await import("@vercel/speed-insights");
  const insights = injectSpeedInsights({
    framework: "vite",
    route: currentRoutePattern(router),
  });
  if (!insights) return;
  router.subscribe("onResolved", () => insights.setRoute(currentRoutePattern(router)));
}
