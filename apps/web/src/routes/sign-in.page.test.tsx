import { beforeEach, describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// `mock.module` is not hoisted like `vi.mock`, so register both module mocks before the dynamic
// `import()` of the page below pulls them in.
const magicLink = mock();
mock.module("@/lib/auth", () => ({ authClient: { signIn: { magicLink } } }));

let search: { redirect?: string; error?: string } = {};
const actualRouter = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
  ...actualRouter,
  getRouteApi: () => ({ useSearch: () => search }),
}));

const { SignInPage, callbackUrl, errorCallbackUrl, normaliseEmail } = await import(
  "./sign-in.page"
);

describe("SignInPage", () => {
  beforeEach(() => {
    magicLink.mockReset();
    search = {};
  });

  it("normalises the email and sends a magic link with a same-origin callback", async () => {
    magicLink.mockResolvedValue({ data: { status: true }, error: null });
    search = { redirect: "/dev/jobs?jobId=1" };
    const user = userEvent.setup();
    render(<SignInPage />);

    await user.type(screen.getByLabelText("Email address"), "  Ada@Example.COM ");
    await user.click(screen.getByRole("button", { name: "Email me a link" }));

    expect(magicLink).toHaveBeenCalledWith({
      email: "ada@example.com",
      callbackURL: `${window.location.origin}/dev/jobs?jobId=1`,
      errorCallbackURL: `${window.location.origin}/sign-in?redirect=%2Fdev%2Fjobs%3FjobId%3D1`,
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Check your inbox (or the api console in development).",
    );
  });

  it("shows a plain-sentence error when sending fails", async () => {
    magicLink.mockResolvedValue({ data: null, error: { status: 500, message: "nope" } });
    const user = userEvent.setup();
    render(<SignInPage />);
    await user.type(screen.getByLabelText("Email address"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not send the link");
    expect(screen.getByRole("button", { name: "Email me a link" })).toBeEnabled();
  });

  it("explains a failed magic-link verification and hides it once a new link is sent", async () => {
    magicLink.mockResolvedValue({ data: { status: true }, error: null });
    search = { error: "INVALID_TOKEN" };
    const user = userEvent.setup();
    render(<SignInPage />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "That sign-in link has expired or was already used. Request a new one below.",
    );
    expect(screen.queryByText("INVALID_TOKEN")).toBeNull();

    await user.type(screen.getByLabelText("Email address"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a link" }));
    await screen.findByRole("status");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("uses generic copy for unknown verification errors and no alert without one", () => {
    search = { error: "SOMETHING_ELSE" };
    const { unmount } = render(<SignInPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "We could not sign you in. Request a new link below.",
    );
    unmount();

    search = {};
    render(<SignInPage />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("helpers: trims/lowercases and only allows same-origin relative redirects", () => {
    expect(normaliseEmail("  X@Y.Z ")).toBe("x@y.z");
    expect(callbackUrl("http://a", "/next")).toBe("http://a/next");
    expect(callbackUrl("http://a", "https://evil.example")).toBe("http://a/");
    expect(callbackUrl("http://a", "//evil.example/x")).toBe("http://a/");
    expect(callbackUrl("http://a", undefined)).toBe("http://a/");
  });

  it("helpers: callbackUrl drops better-auth error params from the redirect target", () => {
    expect(callbackUrl("http://a", "/?error=INVALID_TOKEN")).toBe("http://a/");
    expect(
      callbackUrl("http://a", "/dev/jobs?error=INVALID_TOKEN&error_description=x&jobId=1"),
    ).toBe("http://a/dev/jobs?jobId=1");
  });

  it("helpers: errorCallbackUrl points at /sign-in and keeps the redirect", () => {
    expect(errorCallbackUrl("http://a", undefined)).toBe("http://a/sign-in");
    expect(errorCallbackUrl("http://a", "/dev/jobs?jobId=1")).toBe(
      "http://a/sign-in?redirect=%2Fdev%2Fjobs%3FjobId%3D1",
    );
    // A stale error on the redirect is not re-encoded into the next error callback either.
    expect(errorCallbackUrl("http://a", "/?error=INVALID_TOKEN")).toBe(
      "http://a/sign-in?redirect=%2F",
    );
  });
});
