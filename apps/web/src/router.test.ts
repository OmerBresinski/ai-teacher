import { describe, expect, it } from "bun:test";

/**
 * The runtime route set (TeachDeck `paths.test.ts` equivalent). Every `Link to` in the library
 * resolves against this list; adding or removing a route without updating it fails here, which is
 * the point — the shell, the document routes and `last-shell.ts` all agree on these paths.
 */
const { router } = await import("./router");
const { kitRoute } = await import("./routes/kit.route");
const { authLayoutRoute } = await import("./routes/auth.route");

const SHELL_ROUTES = [
  "/",
  "/sign-in",
  "/lessons",
  "/lessons/new",
  "/worksheets",
  "/worksheets/new",
  "/series",
  "/series/$seriesId",
  "/l/$lessonId",
  "/l/$lessonId/view",
  "/l/$lessonId/present",
  "/w/$worksheetId",
  "/w/$worksheetId/print",
  "/dev/jobs",
  "/kit",
];

describe("router", () => {
  it("registers exactly the shell, document and dev routes", () => {
    // `import.meta.env.DEV` is unset under `bun test`, so this is the production route set.
    expect(import.meta.env.DEV).toBeFalsy();
    expect(Object.keys(router.routesByPath).sort()).toEqual([...SHELL_ROUTES].sort());
  });

  it("ships /kit in production, behind the auth guard", () => {
    expect(router.routesByPath).toHaveProperty("/kit");
    expect((kitRoute.options as { path?: string }).path).toBe("/kit");
    expect(kitRoute.options.getParentRoute?.()).toBe(authLayoutRoute);
  });

  it("nests every signed-in route under the auth guard, and the library pages under one shell", () => {
    const ids = Object.keys(router.routesById);
    const authed = ids.filter((id) => id !== "__root__" && id !== "/sign-in" && id !== "/auth");
    expect(authed.every((id) => id.startsWith("/auth/"))).toBe(true);
    // The seven shell pages share the pathless `library` layout (sidebar, dialogs, shell memory).
    expect(ids.filter((id) => id.startsWith("/auth/library/"))).toHaveLength(7);
    // Document routes and dev tools sit beside it: no sidebar.
    expect(ids.filter((id) => /^\/auth\/(l|w|dev)\//.test(id))).toHaveLength(6);
  });
});
