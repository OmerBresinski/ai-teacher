import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ThemeProvider } from "@tj/ui";
import { type Me, queryKeys } from "@/lib/query";
import { SettingsPage } from "./settings.page";

const ME = {
  user: { id: "u1", email: "ada@school.test", name: "Ada Lovelace", isAnonymous: false },
  workspaceId: "w1",
} as Me;

function renderPage(me: Me | null = ME) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  // Usually the auth layout has already resolved `/me` by the time the page renders.
  if (me) queryClient.setQueryData(queryKeys.me, me);
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light">
        <SettingsPage />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe("SettingsPage", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("is one page of plain sections: Account, then Appearance", () => {
    renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Account",
      "Appearance",
    ]);
  });

  it("shows the account's name and email", () => {
    renderPage();

    const account = screen.getByRole("region", { name: "Account" });
    expect(within(account).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(account).getByText("ada@school.test")).toBeInTheDocument();
  });

  it("says when the account has no name", () => {
    renderPage({ ...ME, user: { ...ME.user, name: "" } });

    expect(screen.getByText("Not set")).toBeInTheDocument();
  });

  it("selects the current theme and applies a new one", () => {
    renderPage();

    const group = screen.getByRole("radiogroup", { name: "Theme" });
    expect(within(group).getByRole("radio", { name: "Light" })).toBeChecked();
    expect(
      within(group)
        .getAllByRole("radio")
        .map((r) => r.getAttribute("value")),
    ).toEqual(["light", "dark", "high-contrast", "system"]);

    fireEvent.click(within(group).getByRole("radio", { name: "Dark" }));
    expect(within(group).getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("tj-theme")).toBe("dark");
  });

  it("shows a loading placeholder, not blanks, while the account loads", () => {
    globalThis.fetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    renderPage(null);

    const account = screen.getByRole("region", { name: "Account" });
    expect(
      within(account).getByRole("status", { name: "Loading your account" }),
    ).toBeInTheDocument();
    expect(within(account).queryByText("Not set")).toBeNull();
    expect(within(account).queryByText("Name")).toBeNull();
  });

  it("says when the account could not load and retries on request", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1)
        return new Response(JSON.stringify({ error: { code: "internal", message: "boom" } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      return new Response(JSON.stringify(ME), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    renderPage(null);

    const account = screen.getByRole("region", { name: "Account" });
    expect(await within(account).findByRole("alert")).toHaveTextContent(
      "We couldn’t load your account details.",
    );
    expect(within(account).queryByText("Not set")).toBeNull();

    fireEvent.click(within(account).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(within(account).getByText("Ada Lovelace")).toBeInTheDocument());
    expect(within(account).queryByRole("alert")).toBeNull();
  });
});
