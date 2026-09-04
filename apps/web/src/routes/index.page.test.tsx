import { beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { FALLBACK_GREETING } from "@tj/domain";
import type { ReactNode } from "react";

const getMe = mock();
const getGreeting = mock();
const signOut = mock();
const navigate = mock();

mock.module("@/lib/api", () => ({
  api: { me: { $get: getMe, greeting: { $get: getGreeting } } },
}));
mock.module("@/lib/auth", () => ({ authClient: { signOut } }));

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
    getMe.mockResolvedValue(resolvedMe());
  });

  it("shows the generated greeting after it resolves", async () => {
    getGreeting.mockResolvedValue(
      jsonResponse(200, { text: "Chalk dust is optional today.", source: "model" }),
    );
    renderPage();

    const greeting = await screen.findByText("Chalk dust is optional today.");
    expect(greeting).toHaveClass("opacity-100");
  });

  it("reserves an invisible greeting line while the query is pending", async () => {
    getGreeting.mockReturnValue(new Promise(() => {}));
    renderPage();

    await waitFor(() => expect(getGreeting).toHaveBeenCalledTimes(1));
    const greeting = screen.getByText(FALLBACK_GREETING);
    expect(greeting).toHaveClass("opacity-0");
    expect(greeting).toHaveAttribute("aria-hidden", "true");
  });

  it("shows the shared fallback when the greeting request fails", async () => {
    getGreeting.mockRejectedValue(new Error("unavailable"));
    renderPage();

    await waitFor(() => expect(screen.getByText(FALLBACK_GREETING)).toHaveClass("opacity-100"));
  });
});
