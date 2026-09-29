import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// `mock.module` is not hoisted like `vi.mock`, so register it before the page's dynamic import.
let search: { token?: string; callbackURL?: string; error?: string } = {};
const actualRouter = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
  ...actualRouter,
  getRouteApi: () => ({ useSearch: () => search }),
  // The "Get a new link" fallback is a plain anchor here; the router is not mounted.
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

const { SignInConfirmPage, magicLinkVerifyUrl } = await import("./sign-in-confirm.page");
const { confirmDestination, rememberRequestedEmail } = await import("@/lib/confirm-destination");

const ORIGIN = window.location.origin;
const API = "https://api.test";

describe("magicLinkVerifyUrl", () => {
  it("keeps same-origin callbacks, absolute or relative, and carries the token", () => {
    const url = new URL(
      magicLinkVerifyUrl(API, ORIGIN, {
        token: "tok",
        callbackURL: `${ORIGIN}/lessons/new?topic=The+cycle`,
      }),
    );
    expect(url.origin + url.pathname).toBe(`${API}/auth/magic-link/verify`);
    expect(url.searchParams.get("token")).toBe("tok");
    expect(url.searchParams.get("callbackURL")).toBe(`${ORIGIN}/lessons/new?topic=The+cycle`);
    // A failed verify comes back to the confirm sheet with the same destination, no token.
    const error = new URL(String(url.searchParams.get("errorCallbackURL")));
    expect(error.origin + error.pathname).toBe(`${ORIGIN}/sign-in/confirm`);
    expect(error.searchParams.get("callbackURL")).toBe("/lessons/new?topic=The+cycle");
    expect(error.searchParams.has("email")).toBe(false);
    expect(error.searchParams.has("token")).toBe(false);
  });

  it("collapses a callback on another origin to this origin", () => {
    const url = new URL(
      magicLinkVerifyUrl(API, ORIGIN, { token: "tok", callbackURL: "https://evil.example/steal" }),
    );
    expect(url.searchParams.get("callbackURL")).toBe(`${ORIGIN}/`);
    expect(url.searchParams.get("errorCallbackURL")).toBe(
      `${ORIGIN}/sign-in/confirm?callbackURL=%2F`,
    );
  });

  it("strips a stale error from the callback", () => {
    const url = new URL(
      magicLinkVerifyUrl(API, ORIGIN, { token: "tok", callbackURL: "/?error=INVALID_TOKEN" }),
    );
    expect(url.searchParams.get("callbackURL")).toBe(`${ORIGIN}/`);
  });
});

describe("confirmDestination", () => {
  it("reads the preview from the callback alone", () => {
    expect(confirmDestination(undefined, ORIGIN)).toEqual({ kind: "dashboard" });
    expect(confirmDestination(`${ORIGIN}/`, ORIGIN)).toEqual({ kind: "dashboard" });
    expect(confirmDestination(`${ORIGIN}/lessons/new?topic=Volcanoes`, ORIGIN)).toEqual({
      kind: "new-lesson",
      topic: "Volcanoes",
    });
    expect(confirmDestination("/lessons/new", ORIGIN)).toEqual({ kind: "other" });
    expect(confirmDestination("/series", ORIGIN)).toEqual({ kind: "other" });
    // Another origin previews what the click would do: this origin's dashboard.
    expect(confirmDestination("https://evil.example/lessons/new?topic=x", ORIGIN)).toEqual({
      kind: "dashboard",
    });
  });
});

describe("SignInConfirmPage", () => {
  let fetchSpy: ReturnType<typeof spyOn>;
  let assign: ReturnType<typeof spyOn>;

  beforeEach(() => {
    search = {};
    fetchSpy = spyOn(globalThis, "fetch");
    assign = spyOn(window.location, "assign").mockImplementation(() => {});
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    assign.mockRestore();
  });

  it("makes no request on load and holds no link or image that reaches the verify URL", () => {
    search = { token: "tok", callbackURL: `${ORIGIN}/` };
    const { container } = render(<SignInConfirmPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Continue to DayBack" })).toBeVisible();
    expect(screen.getByRole("dialog")).toContainElement(
      screen.getByRole("button", { name: "Open my lessons" }),
    );
    expect(screen.getByRole("dialog")).toHaveFocus();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(container.innerHTML).not.toContain("tok");
    expect(container.querySelectorAll("a, img, link, form, iframe")).toHaveLength(0);
    const preview = container.querySelector("[data-confirm-preview]");
    expect(preview).toHaveAttribute("aria-hidden", "true");
    expect(preview).toHaveAttribute("inert");
  });

  it("previews the new-lesson flow with the topic and says Start my lesson", () => {
    search = { token: "tok", callbackURL: `${ORIGIN}/lessons/new?topic=Volcanoes` };
    const { container } = render(<SignInConfirmPage />);
    expect(container.querySelector("[data-confirm-preview]")).toHaveAttribute(
      "data-confirm-preview",
      "new-lesson",
    );
    expect(container.querySelector("[data-confirm-preview]")).toHaveTextContent("Volcanoes");
    expect(screen.getByRole("button", { name: "Start my lesson" })).toBeEnabled();
  });

  it("the button opens the verify URL in this window, with a sanitised callback", async () => {
    search = { token: "tok", callbackURL: "https://evil.example/" };
    const user = userEvent.setup();
    render(<SignInConfirmPage />);
    await user.click(screen.getByRole("button", { name: "Open my lessons" }));

    expect(assign).toHaveBeenCalledTimes(1);
    const target = new URL(String(assign.mock.calls[0]?.[0]));
    expect(target.pathname).toBe("/api/auth/magic-link/verify");
    expect(target.searchParams.get("token")).toBe("tok");
    expect(target.searchParams.get("callbackURL")).toBe(`${ORIGIN}/`);
    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("an expired link shows the resend form in the same sheet over the same preview", () => {
    // The address comes from this browser's own request, never from the URL.
    rememberRequestedEmail("t@school.test");
    search = { callbackURL: "/lessons/new?topic=Volcanoes", error: "INVALID_TOKEN" };
    const { container } = render(<SignInConfirmPage />);
    expect(screen.getByRole("heading", { level: 1, name: "This link has expired" })).toBeVisible();
    expect(screen.getByLabelText("Email address")).toHaveValue("t@school.test");
    expect(screen.getByRole("button", { name: "Email me a new link" })).toBeEnabled();
    expect(container.querySelector("[data-confirm-preview]")).toHaveTextContent("Volcanoes");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a link without a token says so and offers a new one, with an empty field in a new browser", () => {
    localStorage.clear();
    render(<SignInConfirmPage />);
    expect(screen.getByLabelText("Email address")).toHaveValue("");
    expect(
      screen.getByRole("heading", { level: 1, name: "This link is incomplete" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Email me a new link" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Open my lessons" })).toBeNull();
  });
});
