import { afterAll, describe, expect, it } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { isRedirect } from "@tanstack/react-router";
import { anonymousMe, installFakeApi, teacherMe } from "@/test/fake-api";
import { authLayoutRoute } from "./auth.route";
import { guestAccess } from "./guest.route";
import { lessonBriefRoute } from "./lesson-brief.route";

const { fakeApi, restore } = installFakeApi();
afterAll(restore);

/** Run a route's `beforeLoad` the way the router does, returning the redirect target or context. */
async function beforeLoad(
  route: { options: { beforeLoad?: unknown } },
  href: string,
  extra: Record<string, unknown> = {},
) {
  const run = route.options.beforeLoad as (opts: unknown) => Promise<unknown>;
  const url = new URL(href, "http://localhost");
  try {
    return {
      context: await run({
        context: { queryClient: new QueryClient(), ...extra },
        location: { href, pathname: url.pathname },
        search: Object.fromEntries(url.searchParams),
      }),
    };
  } catch (thrown) {
    if (!isRedirect(thrown)) throw thrown;
    return { redirect: thrown.options };
  }
}

describe("guestAccess (TEACH-244 rows 1, 6, 7)", () => {
  it("a teacher may open every guest route", () => {
    expect(guestAccess(teacherMe, "/l/x")).toBe("allow");
    expect(guestAccess(teacherMe, "/lessons/new")).toBe("allow");
  });
  it("no session reaches only the brief; an anonymous one its lesson pages too", () => {
    expect(guestAccess(null, "/lessons/new")).toBe("allow");
    expect(guestAccess(null, "/l/x")).toBe("sign-in");
    expect(guestAccess(null, "/l/x/present")).toBe("sign-in");
    expect(guestAccess(anonymousMe, "/l/x")).toBe("allow");
    expect(guestAccess(anonymousMe, "/lessons/new")).toBe("allow");
  });
});

describe("account-only routes", () => {
  it("send an anonymous session to /sign-in with the URL it wanted (row 7)", async () => {
    fakeApi.session = "anonymous";
    for (const href of ["/", "/worksheets", "/l/abc/print"]) {
      const result = await beforeLoad(authLayoutRoute, href);
      expect(result.redirect).toMatchObject({ to: "/sign-in", search: { redirect: href } });
    }
  });
  it("send no session to /sign-in (row 6) and let a teacher through", async () => {
    fakeApi.session = null;
    expect((await beforeLoad(authLayoutRoute, "/worksheets")).redirect).toMatchObject({
      to: "/sign-in",
    });
    fakeApi.session = "teacher";
    expect((await beforeLoad(authLayoutRoute, "/")).context).toMatchObject({ me: teacherMe });
  });
});

describe("/lessons/new?source=1 (row 8, ruling 110)", () => {
  it("signs a visitor without an account in first, topic and source kept", async () => {
    for (const me of [null, anonymousMe]) {
      const href = "/lessons/new?topic=Volcanoes&source=1";
      const result = await beforeLoad(lessonBriefRoute, href, { me });
      expect(result.redirect).toMatchObject({ to: "/sign-in", search: { redirect: href } });
    }
  });
  it("leaves a teacher, and a plain signed-out brief, on the page", async () => {
    expect(
      (await beforeLoad(lessonBriefRoute, "/lessons/new?source=1", { me: teacherMe })).redirect,
    ).toBeUndefined();
    expect(
      (await beforeLoad(lessonBriefRoute, "/lessons/new?topic=Volcanoes", { me: null })).redirect,
    ).toBeUndefined();
  });
});
