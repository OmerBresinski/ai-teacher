import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// `mock.module` is not hoisted like `vi.mock`, so register it before the page's dynamic import.
let search: { token?: string; callbackURL?: string; errorCallbackURL?: string } = {};
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

const ORIGIN = window.location.origin;
const API = "https://api.test";

describe("magicLinkVerifyUrl", () => {
  it("keeps same-origin callbacks, absolute or relative, and carries the token", () => {
    const url = new URL(
      magicLinkVerifyUrl(API, ORIGIN, {
        token: "tok",
        callbackURL: `${ORIGIN}/lessons/new?topic=The+cycle`,
        errorCallbackURL: "/sign-in?redirect=%2Flessons",
      }),
    );
    expect(url.origin + url.pathname).toBe(`${API}/auth/magic-link/verify`);
    expect(url.searchParams.get("token")).toBe("tok");
    expect(url.searchParams.get("callbackURL")).toBe(`${ORIGIN}/lessons/new?topic=The+cycle`);
    expect(url.searchParams.get("errorCallbackURL")).toBe(`${ORIGIN}/sign-in?redirect=%2Flessons`);
  });

  it("collapses a callback on another origin to this origin", () => {
    const url = new URL(
      magicLinkVerifyUrl(API, ORIGIN, {
        token: "tok",
        callbackURL: "https://evil.example/steal",
        errorCallbackURL: "//evil.example/sign-in",
      }),
    );
    expect(url.searchParams.get("callbackURL")).toBe(`${ORIGIN}/`);
    expect(url.searchParams.get("errorCallbackURL")).toBe(`${ORIGIN}/sign-in?redirect=%2F`);
  });

  it("strips a stale error from the callback and defaults the error callback to /sign-in", () => {
    const url = new URL(
      magicLinkVerifyUrl(API, ORIGIN, { token: "tok", callbackURL: "/?error=INVALID_TOKEN" }),
    );
    expect(url.searchParams.get("callbackURL")).toBe(`${ORIGIN}/`);
    expect(url.searchParams.get("errorCallbackURL")).toBe(`${ORIGIN}/sign-in?redirect=%2F`);
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
    search = { token: "tok", callbackURL: `${ORIGIN}/lessons` };
    const { container } = render(<SignInConfirmPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Sign in to DayBack" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(container.innerHTML).not.toContain("tok");
    expect(container.querySelectorAll("a, img, link, form, iframe")).toHaveLength(0);
  });

  it("the Sign in button opens the verify URL in this window, with a sanitised callback", async () => {
    search = {
      token: "tok",
      callbackURL: "https://evil.example/",
      errorCallbackURL: `${ORIGIN}/sign-in?redirect=%2F`,
    };
    const user = userEvent.setup();
    render(<SignInConfirmPage />);
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(assign).toHaveBeenCalledTimes(1);
    const target = new URL(String(assign.mock.calls[0]?.[0]));
    expect(target.pathname).toBe("/api/auth/magic-link/verify");
    expect(target.searchParams.get("token")).toBe("tok");
    expect(target.searchParams.get("callbackURL")).toBe(`${ORIGIN}/`);
    expect(target.searchParams.get("errorCallbackURL")).toBe(`${ORIGIN}/sign-in?redirect=%2F`);
    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a link without a token says so and offers a new one", () => {
    render(<SignInConfirmPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("This sign-in link is incomplete.");
    expect(screen.getByRole("link", { name: "Get a new link" })).toHaveAttribute(
      "href",
      "/sign-in",
    );
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });
});
