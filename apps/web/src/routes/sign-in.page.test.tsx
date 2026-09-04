import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const magicLink = vi.fn();
vi.mock("@/lib/auth", () => ({ authClient: { signIn: { magicLink } } }));

let search: { redirect?: string } = {};
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, getRouteApi: () => ({ useSearch: () => search }) };
});

const { SignInPage, callbackUrl, normaliseEmail } = await import("./sign-in.page");

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

  it("helpers: trims/lowercases and only allows same-origin relative redirects", () => {
    expect(normaliseEmail("  X@Y.Z ")).toBe("x@y.z");
    expect(callbackUrl("http://a", "/next")).toBe("http://a/next");
    expect(callbackUrl("http://a", "https://evil.example")).toBe("http://a/");
    expect(callbackUrl("http://a", undefined)).toBe("http://a/");
  });
});
