import { describe, expect, it } from "bun:test";

/**
 * The runtime route set (TeachDeck `paths.test.ts` equivalent). Every `Link to` in the library
 * resolves against this list; adding or removing a route without updating it fails here, which is
 * the point — the shell, the editor stubs and `last-shell.ts` all agree on these paths.
 */
const { router } = await import("./router");

const SHELL_ROUTES = [
  "/",
  "/sign-in",
  "/lessons",
  "/worksheets",
  "/series",
  "/series/$seriesId",
  "/l/$lessonId",
  "/l/$lessonId/present",
  "/w/$worksheetId",
  "/w/$worksheetId/print",
  "/dev/jobs",
];

describe("router", () => {
  it("registers exactly the shell, editor-stub and dev routes (+ /kit in DEV)", () => {
    const registered = Object.keys(router.routesByPath).sort();
    const expected = [...SHELL_ROUTES, ...(import.meta.env.DEV ? ["/kit"] : [])].sort();
    expect(registered).toEqual(expected);
  });

  it("nests every signed-in route under the auth guard, and the library pages under one shell", () => {
    const ids = Object.keys(router.routesById);
    const authed = ids.filter((id) => id !== "__root__" && id !== "/sign-in" && id !== "/auth");
    expect(authed.every((id) => id.startsWith("/auth/"))).toBe(true);
    // The five shell pages share the pathless `library` layout (sidebar, dialogs, shell memory).
    expect(ids.filter((id) => id.startsWith("/auth/library/"))).toHaveLength(5);
    // Editor stubs and dev tools sit beside it: no sidebar.
    expect(ids.filter((id) => /^\/auth\/(l|w|dev)\//.test(id))).toHaveLength(5);
  });
});
