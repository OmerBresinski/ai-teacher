import { describe, expect, it } from "bun:test";

/**
 * The runtime route set (TeachDeck `paths.test.ts` equivalent). Every `Link to` in the library
 * resolves against this list; adding or removing a route without updating it fails here, which is
 * the point — the shell, the document routes and `last-shell.ts` all agree on these paths.
 */
const { router } = await import("./router");
const { kitRoute } = await import("./routes/kit.route");
const { authLayoutRoute } = await import("./routes/auth.route");
const { guestLayoutRoute } = await import("./routes/guest.route");

const SHELL_ROUTES = [
  "/",
  "/sign-in",
  "/sign-in/confirm",
  "/lessons",
  "/lessons/new",
  "/worksheets",
  "/worksheets/new",
  "/series",
  "/series/$seriesId",
  "/l/$lessonId",
  "/l/$lessonId/view",
  "/l/$lessonId/present",
  "/l/$lessonId/print",
  "/w/$worksheetId",
  "/w/$worksheetId/print",
  "/kit",
  "/settings",
];

describe("router", () => {
  it("registers exactly the shell and document routes — no /dev/jobs in a production build", () => {
    // `import.meta.env.DEV` is unset and VITE_APP_ENV is not "preview" under `bun test`, so this
    // is the production route set (TEACH-81): the Jobs / SSE demo is not registered at all.
    expect(import.meta.env.DEV).toBeFalsy();
    expect(import.meta.env.VITE_APP_ENV).not.toBe("preview");
    expect(Object.keys(router.routesByPath).sort()).toEqual([...SHELL_ROUTES].sort());
    expect(router.routesByPath).not.toHaveProperty("/dev/jobs");
  });

  it("ships /kit in production, behind the auth guard", () => {
    expect(router.routesByPath).toHaveProperty("/kit");
    expect((kitRoute.options as { path?: string }).path).toBe("/kit");
    expect(kitRoute.options.getParentRoute?.()).toBe(authLayoutRoute);
  });

  it("nests every account route under the auth guard, and the library pages under one shell", () => {
    const ids = Object.keys(router.routesById);
    // `/sign-in/confirm` is public: the magic-link email lands there before any session (TEACH-246).
    // `/guest` holds the signed-out lesson routes (TEACH-244).
    const PUBLIC = new Set(["__root__", "/sign-in", "/sign-in/confirm", "/auth", "/guest"]);
    const authed = ids.filter((id) => !PUBLIC.has(id));
    expect(authed.every((id) => id.startsWith("/auth/") || id.startsWith("/guest/"))).toBe(true);
    // The six shell pages and Settings share the pathless `library` layout (sidebar, dialogs).
    expect(ids.filter((id) => id.startsWith("/auth/library/"))).toHaveLength(7);
    // Account-only document routes: print and the worksheets. (`/auth/dev/jobs` joins in dev.)
    expect(ids.filter((id) => /^\/auth\/(l|w)\//.test(id)).sort()).toEqual([
      "/auth/l/$lessonId/print",
      "/auth/w/$worksheetId",
      "/auth/w/$worksheetId/print",
    ]);
  });

  it("puts exactly the brief and a lesson's own pages under the guest layout (TEACH-244)", () => {
    const guest = Object.keys(router.routesById).filter((id) => id.startsWith("/guest/"));
    expect(guest.sort()).toEqual(
      [
        "/guest/lessons/new",
        "/guest/l/$lessonId",
        "/guest/l/$lessonId/view",
        "/guest/l/$lessonId/present",
      ].sort(),
    );
    expect(guestLayoutRoute.id).toBe("/guest");
  });
});
