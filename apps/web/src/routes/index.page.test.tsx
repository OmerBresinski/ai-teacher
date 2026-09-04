import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FALLBACK_GREETING } from "@tj/domain";
import type { ReactNode } from "react";

const getMe = mock();
const getGreeting = mock();
const signOut = mock();
const navigate = mock();

// `mock.module` is process-wide and outlives this file, so other suites (e.g. `lib/query.test.ts`,
// which stubs `fetch` under the real client) would otherwise see these fakes when they run later.
// Delegate to the real client once this suite is finished. Destructure the value now: the module
// namespace is a live binding that `mock.module` repoints at the mock, which would loop forever.
let suiteActive = true;
const { api: realApi } = await import("@/lib/api");
type MeGet = typeof realApi.me.$get;
type GreetingGet = typeof realApi.me.greeting.$get;
mock.module("@/lib/api", () => ({
  api: {
    me: {
      $get: ((...args: Parameters<MeGet>) =>
        suiteActive ? getMe(...args) : realApi.me.$get(...args)) as MeGet,
      greeting: {
        $get: ((...args: Parameters<GreetingGet>) =>
          suiteActive ? getGreeting(...args) : realApi.me.greeting.$get(...args)) as GreetingGet,
      },
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

describe("IndexPage greeting", () => {
  beforeEach(() => {
    getMe.mockReset();
    getGreeting.mockReset();
    signOut.mockReset();
    navigate.mockReset();
    getMe.mockImplementation(async () => resolvedMe());
  });

  it("shows the generated greeting after it resolves", async () => {
    getGreeting.mockResolvedValue(
      jsonResponse(200, { text: "Chalk dust is optional today.", source: "model" }),
    );
    renderPage();

    const greeting = await screen.findByText("Chalk dust is optional today.", { selector: "p" });
    expect(greeting).toHaveClass("opacity-100");
  });

  it("reserves an invisible greeting line while the query is pending", async () => {
    getGreeting.mockReturnValue(new Promise(() => {}));
    renderPage();

    await waitFor(() => expect(getGreeting).toHaveBeenCalledTimes(1));
    const greeting = screen.getByText(FALLBACK_GREETING, { selector: "p" });
    expect(greeting).toHaveClass("opacity-0");
    expect(greeting).toHaveAttribute("aria-hidden", "true");
  });

  it("fetches a new joke when the refresh button is pressed", async () => {
    getGreeting
      .mockResolvedValueOnce(jsonResponse(200, { text: "First joke.", source: "model" }))
      .mockResolvedValueOnce(jsonResponse(200, { text: "Second joke.", source: "model" }));
    renderPage();

    await screen.findByText("First joke.", { selector: "p" });
    fireEvent.click(screen.getByRole("button", { name: "New joke" }));

    const next = await screen.findByText("Second joke.", { selector: "p" });
    expect(next).toHaveClass("opacity-100");
    expect(screen.getByRole("status")).toHaveTextContent("Second joke.");
    expect(getGreeting).toHaveBeenCalledTimes(2);
  });

  it("shows the shared fallback when the greeting request fails", async () => {
    getGreeting.mockRejectedValue(new Error("unavailable"));
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(FALLBACK_GREETING, { selector: "p" })).toHaveClass("opacity-100"),
    );
  });
});
