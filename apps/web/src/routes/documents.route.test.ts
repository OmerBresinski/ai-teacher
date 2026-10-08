import { afterAll, describe, expect, it, mock } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { isNotFound } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { installFakeApi } from "@/test/fake-api";

const { restore } = installFakeApi();
const actualRouter = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
  ...actualRouter,
  Link: ({ children, to }: { children: ReactNode; to: string }) =>
    createElement("a", { href: to }, children),
}));

const { lessonEditorRoute, worksheetEditorRoute } = await import("./documents.route");
const { rootRoute } = await import("./root.route");

/** A uuid the Workspace does not hold; ids are server-minted (ADR 0024 §11). */
const MISSING = "00000000-0000-4000-8000-000000000000";

/** Run a route's `loader` the way the router does and return what it threw, if anything. */
async function loaderThrows(
  route: { options: { loader?: unknown } },
  params: Record<string, string>,
): Promise<unknown> {
  const load = route.options.loader as (opts: unknown) => Promise<unknown>;
  try {
    await load({ context: { queryClient: new QueryClient() }, params });
    return undefined;
  } catch (thrown) {
    return thrown;
  }
}

describe("document routes", () => {
  it("a held id loads its document (the control for the not-found cases)", async () => {
    const load = lessonEditorRoute.options.loader as (opts: unknown) => Promise<{ title: string }>;
    const document = await load({
      context: { queryClient: new QueryClient() },
      params: { lessonId: "demo-water-cycle" },
    });
    expect(document.title).toBe("The water cycle");
  });
});

describe("document routes with an id the Workspace does not hold", () => {
  it("the lesson and worksheet editor loaders throw notFound()", async () => {
    expect(isNotFound(await loaderThrows(lessonEditorRoute, { lessonId: MISSING }))).toBe(true);
    expect(isNotFound(await loaderThrows(worksheetEditorRoute, { worksheetId: MISSING }))).toBe(
      true,
    );
  });

  it("the root renders the not-found page for it", () => {
    const NotFound = rootRoute.options.notFoundComponent as () => ReactNode;
    render(createElement(NotFound));
    expect(screen.getByText("Page not found")).toBeVisible();
    expect(screen.getByRole("link", { name: "Go to the home page" })).toHaveAttribute("href", "/");
  });
});

afterAll(() => {
  mock.restore();
  restore();
});
