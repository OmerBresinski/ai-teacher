import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const getMe = mock();
const signOut = mock();
const navigate = mock();

// `mock.module` is process-wide and outlives this file, so other suites (e.g. `lib/query.test.ts`,
// which stubs `fetch` under the real client) would otherwise see these fakes when they run later.
// Delegate to the real client once this suite is finished. Destructure the value now: the module
// namespace is a live binding that `mock.module` repoints at the mock, which would loop forever.
let suiteActive = true;
const { api: realApi } = await import("@/lib/api");
type MeGet = typeof realApi.me.$get;
mock.module("@/lib/api", () => ({
  api: {
    me: {
      $get: ((...args: Parameters<MeGet>) =>
        suiteActive ? getMe(...args) : realApi.me.$get(...args)) as MeGet,
    },
  },
}));
mock.module("@/lib/auth", () => ({ authClient: { signOut } }));

afterAll(() => {
  suiteActive = false;
});

const actualRouter = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
  ...actualRouter,
  Link: ({ children }: { children: ReactNode }) => <a href="/dev/jobs">{children}</a>,
  useNavigate: () => navigate,
}));

const { IndexPage } = await import("./index.page");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <IndexPage />
    </QueryClientProvider>,
  );
}

function resolvedMe() {
  return jsonResponse(200, {
    user: { id: "user-1", email: "ada@example.com", name: "Ada" },
    workspaceId: "workspace-1",
  });
}

describe("IndexPage", () => {
  beforeEach(() => {
    getMe.mockReset();
    signOut.mockReset();
    navigate.mockReset();
    getMe.mockImplementation(async () => resolvedMe());
  });

  it("renders the signed-in user's name and email", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Hello, Ada" })).toBeVisible();
    expect(screen.getByText("ada@example.com")).toBeVisible();
  });

  it("signs out and navigates to the sign-in page", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(navigate).toHaveBeenCalledWith({ to: "/sign-in", search: {} });
  });
});
