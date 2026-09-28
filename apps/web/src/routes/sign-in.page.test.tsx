import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// `mock.module` is not hoisted like `vi.mock`, so register both module mocks before the dynamic
// `import()` of the page below pulls them in.
const magicLink = mock();
const social = mock();
const signOut = mock();
mock.module("@/lib/auth", () => ({ authClient: { signIn: { magicLink, social }, signOut } }));
let providers = { google: true, microsoft: false };
const fetchAuthProviders = mock(async () => providers);
mock.module("@/lib/auth-providers", () => ({ fetchAuthProviders }));

let search: { redirect?: string; error?: string; via?: "microsoft" } = {};
const actualRouter = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
  ...actualRouter,
  getRouteApi: () => ({ useSearch: () => search }),
}));

const { SIGN_OUT_FAILED, sessionBoundary } = await import("@/lib/session-boundary");
const { POSES, mouthPath } = await import("@/components/brand/cast-rig");
const { callbackUrl, errorCallbackUrl } = await import("@/lib/auth-redirect");
const { SignInPage, socialStartError, normaliseEmail, signInErrorMessage } = await import(
  "./sign-in.page"
);

const GOOGLE = { name: "Continue with Google" } as const;
const MICROSOFT = { name: "Continue with Microsoft" } as const;
const NOT_SET_UP = "Google sign-in is not set up here. Use the email link below.";
const INTERRUPTED = "Your Google sign-in took too long or was interrupted. Try again.";
const EXPIRED = "That sign-in link has expired or was already used. Request a new one below.";

/** Whether `b` comes after `a` in document order. */
function follows(a: Node, b: Node): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("SignInPage", () => {
  beforeEach(() => {
    magicLink.mockReset();
    social.mockReset();
    signOut.mockReset();
    search = {};
    providers = { google: true, microsoft: false };
    fetchAuthProviders.mockClear();
  });

  afterEach(() => {
    // The boundary is a module singleton: a notice left behind would leak into the next case. It
    // runs before Testing Library unmounts the page, so the reset re-renders it inside act.
    if (sessionBoundary.getSnapshot().notice) act(() => sessionBoundary.reset());
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
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/^Check your inbox/);
    expect(status).toHaveTextContent(
      "We sent a sign-in link to ada@example.com. It works once and expires in 15 minutes.",
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

  it("shows the send error and frees both buttons when sending fails at the network level", async () => {
    magicLink.mockRejectedValue(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    render(<SignInPage />);
    await user.type(screen.getByLabelText("Email address"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not send the link");
    expect(screen.getByRole("button", { name: "Email me a link" })).toBeEnabled();
    expect(screen.getByRole("button", GOOGLE)).toBeEnabled();
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

  it("puts Continue with Google above the email form with one or divider", () => {
    search = { redirect: "/lessons" };
    render(<SignInPage />);
    const google = screen.getByRole("button", GOOGLE);
    const email = screen.getByLabelText("Email address");
    const heading = screen.getByRole("heading", { level: 1 });
    expect(follows(heading, google)).toBe(true);
    expect(follows(google, email)).toBe(true);
    expect(google).toHaveAttribute("type", "button");
    expect(screen.getAllByText("or")).toHaveLength(1);
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("starts Google sign-in with the same callbacks as the magic link and stays disabled", async () => {
    // Success: better-auth's redirect plugin navigates to Google; the page only waits.
    social.mockResolvedValue({ data: { url: "https://accounts.google.com/", redirect: true } });
    search = { redirect: "/lessons" };
    const user = userEvent.setup();
    render(<SignInPage />);

    await user.click(screen.getByRole("button", GOOGLE));

    expect(social).toHaveBeenCalledTimes(1);
    expect(social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: `${window.location.origin}/lessons`,
      errorCallbackURL: `${window.location.origin}/sign-in?redirect=%2Flessons`,
    });
    const opening = screen.getByRole("button", { name: "Opening Google…" });
    expect(opening).toBeDisabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says Google is not set up when the api has no Google provider", async () => {
    social.mockResolvedValue({
      data: null,
      error: { status: 404, statusText: "Not Found", code: "PROVIDER_NOT_FOUND" },
    });
    const user = userEvent.setup();
    render(<SignInPage />);
    await user.click(screen.getByRole("button", GOOGLE));
    expect(await screen.findByRole("alert")).toHaveTextContent(NOT_SET_UP);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("button", GOOGLE)).toBeEnabled();
  });

  it("says Google could not be reached for any other start failure", async () => {
    social.mockResolvedValue({ data: null, error: { status: 500, statusText: "Error" } });
    const user = userEvent.setup();
    const { unmount } = render(<SignInPage />);
    await user.click(screen.getByRole("button", GOOGLE));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not reach Google. Try again, or use the email link below.",
    );
    expect(screen.getByRole("button", GOOGLE)).toBeEnabled();
    unmount();

    // A network failure rejects instead of resolving with `error`; the button must not stay stuck.
    social.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<SignInPage />);
    await user.click(screen.getByRole("button", GOOGLE));
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not reach Google.");
    expect(screen.getByRole("button", GOOGLE)).toBeEnabled();
  });

  it("explains each failed Google round trip in one alert", () => {
    const cases: [string, string][] = [
      ["access_denied", "Google sign-in was cancelled. Try again, or use the email link below."],
      [
        "account_not_linked",
        "We could not match that Google account to your account. Use the email link below.",
      ],
      ["state_mismatch", INTERRUPTED],
      ["state_not_found", INTERRUPTED],
      ["please_restart_the_process", INTERRUPTED],
      ["constructor", "We could not sign you in. Request a new link below."],
    ];
    for (const [code, copy] of cases) {
      search = { error: code };
      const { unmount } = render(<SignInPage />);
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.getByRole("alert")).toHaveTextContent(copy);
      expect(screen.queryByText(code)).toBeNull();
      unmount();
    }
  });

  it("shows one alert at a time: the newest failure replaces the older one", async () => {
    social.mockResolvedValue({ data: null, error: { status: 404, code: "PROVIDER_NOT_FOUND" } });
    magicLink.mockResolvedValue({ data: null, error: { status: 500, message: "nope" } });
    search = { error: "INVALID_TOKEN" };
    const user = userEvent.setup();
    render(<SignInPage />);

    await user.click(screen.getByRole("button", GOOGLE));
    await screen.findByText(NOT_SET_UP);
    expect(screen.getAllByRole("alert")).toHaveLength(1);

    await user.type(screen.getByLabelText("Email address"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a link" }));
    await screen.findByText(/We could not send the link/);
    expect(screen.getAllByRole("alert")).toHaveLength(1);

    await user.click(screen.getByRole("button", GOOGLE));
    await screen.findByText(NOT_SET_UP);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("runs one sign-in at a time: each button waits while the other request is in flight", async () => {
    let finishSend: (value: unknown) => void = () => {};
    magicLink.mockReturnValue(new Promise((resolve) => (finishSend = resolve)));
    social.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    const { unmount } = render(<SignInPage />);

    await user.type(screen.getByLabelText("Email address"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a link" }));
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
    expect(screen.getByRole("button", GOOGLE)).toBeDisabled();
    await act(async () => finishSend({ data: null, error: { status: 500 } }));
    expect(screen.getByRole("button", GOOGLE)).toBeEnabled();
    unmount();

    render(<SignInPage />);
    await user.type(screen.getByLabelText("Email address"), "ada@example.com");
    await user.click(screen.getByRole("button", GOOGLE));
    expect(screen.getByRole("button", { name: "Email me a link" })).toBeDisabled();
    // Enter in the field is implicit submission, which a disabled submit button blocks.
    await user.type(screen.getByLabelText("Email address"), "{Enter}");
    expect(magicLink).toHaveBeenCalledTimes(1);
  });

  it("hides Continue with Google once the magic link is sent", async () => {
    magicLink.mockResolvedValue({ data: { status: true }, error: null });
    const user = userEvent.setup();
    render(<SignInPage />);
    await user.type(screen.getByLabelText("Email address"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a link" }));
    await screen.findByRole("status");
    expect(screen.queryByRole("button", GOOGLE)).toBeNull();
    expect(screen.queryByText("or")).toBeNull();
  });

  it("re-enables the button when the page comes back from the back/forward cache", async () => {
    social.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<SignInPage />);
    await user.click(screen.getByRole("button", GOOGLE));
    expect(screen.getByRole("button", { name: "Opening Google…" })).toBeDisabled();

    const pageshow = new Event("pageshow");
    Object.defineProperty(pageshow, "persisted", { value: true });
    act(() => {
      window.dispatchEvent(pageshow);
    });
    expect(screen.getByRole("button", GOOGLE)).toBeEnabled();
  });

  it("says DayBack: one h1, the brand lockup with its mark, never Teaching Journey", () => {
    const { container } = render(<SignInPage />);
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Welcome to DayBack");
    // The lockup is a word, not a link: it adds no tab stop before the email field.
    const lockup = screen.getByText("DayBack", { exact: true });
    expect(lockup.closest("a")).toBeNull();
    expect(lockup.querySelector('svg[viewBox="0 0 48 48"]')).toHaveAttribute("aria-hidden", "true");
    expect(container.textContent).not.toContain("Teaching Journey");
  });

  it("keeps the order: heading, Google, or, email, submit, then the legal links", () => {
    render(<SignInPage />);
    const order = [
      screen.getByRole("heading", { level: 1 }),
      screen.getByRole("button", GOOGLE),
      screen.getByText("or"),
      screen.getByLabelText("Email address"),
      screen.getByRole("button", { name: "Email me a link" }),
      screen.getByRole("link", { name: "Terms" }),
      screen.getByRole("link", { name: "Privacy notice" }),
    ];
    order.reduce((before, node) => {
      expect(before.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      return node;
    });
    // The two lines under the heading are gone: the buttons say what happens.
    expect(screen.queryByText(/No password needed|The same steps create your account/)).toBeNull();
  });

  it("links the homepage's terms and privacy notice on the same origin", () => {
    render(<SignInPage />);
    const terms = screen.getByRole("link", { name: "Terms" });
    const privacy = screen.getByRole("link", { name: "Privacy notice" });
    expect(terms).toHaveAttribute("href", "/homepage/terms/");
    expect(privacy).toHaveAttribute("href", "/homepage/privacy/");
    expect(terms).not.toHaveAttribute("target");
    expect(privacy).not.toHaveAttribute("target");
    expect(terms.closest("p")).toHaveTextContent(
      "By continuing you agree to the Terms and have read the Privacy notice.",
    );
  });

  it("hides every piece of artwork from assistive technology", () => {
    const { container } = render(<SignInPage />);
    // The cast: Slides, Worksheet, Plan and Check, inside one hidden stage.
    const cast = [...container.querySelectorAll("[data-cast]")].map((el) =>
      el.getAttribute("data-cast"),
    );
    expect(cast.toSorted()).toEqual(["activity", "answers", "slides", "support"]);
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(6);
    for (const svg of svgs) expect(svg.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("with reduced motion the cast stays still and only its faces follow the page", async () => {
    // ADR 0028: reduced motion means no motion, so GSAP is never loaded and only faces change.
    const realMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    try {
      await facesFollowThePage();
    } finally {
      window.matchMedia = realMatchMedia;
    }
  });

  async function facesFollowThePage() {
    magicLink.mockResolvedValue({ data: { status: true }, error: null });
    search = { error: "INVALID_TOKEN" };
    const user = userEvent.setup();
    const { container } = render(<SignInPage />);
    const mouth = () => container.querySelector('[data-cast="support"] .mouth')?.getAttribute("d");
    expect(mouth()).toBe(mouthPath(POSES.support.face, -0.35));

    await user.type(screen.getByLabelText("Email address"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a link" }));
    await screen.findByRole("status");
    expect(mouth()).toBe(mouthPath(POSES.support.face, 0.8));
    expect(container.querySelector("[data-cast-stage]")).toHaveAttribute(
      "data-cast-stage",
      "still",
    );
  }

  it("sent: shows the address, drops Google and the form, and no dev hint outside vite dev", async () => {
    magicLink.mockResolvedValue({ data: { status: true }, error: null });
    const user = userEvent.setup();
    render(<SignInPage />);
    await user.type(screen.getByLabelText("Email address"), "  Ada@Example.COM ");
    await user.click(screen.getByRole("button", { name: "Email me a link" }));

    expect(await screen.findAllByRole("status")).toHaveLength(1);
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("button", GOOGLE)).toBeNull();
    expect(screen.queryByLabelText("Email address")).toBeNull();
    // `import.meta.env.DEV` is unset under bun test, as in a build.
    expect(screen.queryByText(/api console/)).toBeNull();
  });

  it("sent: Use a different email brings the form back with the address and focus in the field", async () => {
    magicLink.mockResolvedValue({ data: { status: true }, error: null });
    const user = userEvent.setup();
    render(<SignInPage />);
    await user.type(screen.getByLabelText("Email address"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a link" }));
    await user.click(await screen.findByRole("button", { name: "Use a different email" }));

    const field = screen.getByLabelText("Email address");
    expect(field).toHaveValue("ada@example.com");
    expect(field).toHaveFocus();
    expect(screen.getByRole("button", GOOGLE)).toBeEnabled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("the sign-out notice outranks every other alert and keeps Retry sign out", async () => {
    sessionBoundary.reset(null, true, SIGN_OUT_FAILED);
    signOut.mockResolvedValue({ data: { success: true }, error: null });
    search = { error: "INVALID_TOKEN" };
    const user = userEvent.setup();
    render(<SignInPage />);

    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-out could not be confirmed");
    expect(screen.queryByText(EXPIRED)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Retry sign out" }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("the send error outranks the ?error= message in the one alert slot", async () => {
    magicLink.mockResolvedValue({ data: null, error: { status: 500, message: "nope" } });
    search = { error: "INVALID_TOKEN" };
    const user = userEvent.setup();
    render(<SignInPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(EXPIRED);

    await user.type(screen.getByLabelText("Email address"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a link" }));
    await screen.findByText(/We could not send the link/);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    // The slot sits above the Google button, not under the field.
    expect(
      screen.getByRole("alert").compareDocumentPosition(screen.getByRole("button", GOOGLE)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("helpers: socialStartError reads 404 or PROVIDER_NOT_FOUND as not set up", () => {
    expect(socialStartError({ status: 404 })).toBe("not-set-up");
    expect(socialStartError({ status: 400, code: "PROVIDER_NOT_FOUND" })).toBe("not-set-up");
    expect(socialStartError({ status: 500 })).toBe("unreachable");
    expect(socialStartError({ status: 429 })).toBe("unreachable");
  });

  it("hides Continue with Microsoft until the api says it is on", async () => {
    render(<SignInPage />);
    await act(async () => {});
    expect(fetchAuthProviders).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", MICROSOFT)).toBeNull();
  });

  it("shows Continue with Microsoft under Google and starts it with a via=microsoft error callback", async () => {
    providers = { google: true, microsoft: true };
    social.mockResolvedValue({
      data: { url: "https://login.microsoftonline.com/", redirect: true },
    });
    search = { redirect: "/library" };
    const user = userEvent.setup();
    render(<SignInPage />);

    const microsoft = await screen.findByRole("button", MICROSOFT);
    expect(follows(screen.getByRole("button", GOOGLE), microsoft)).toBe(true);
    expect(follows(microsoft, screen.getByLabelText("Email address"))).toBe(true);
    expect(microsoft.querySelector("svg")).toHaveAttribute("aria-hidden", "true");

    await user.click(microsoft);
    expect(social).toHaveBeenCalledWith({
      provider: "microsoft",
      callbackURL: `${window.location.origin}/library`,
      errorCallbackURL: `${window.location.origin}/sign-in?redirect=%2Flibrary&via=microsoft`,
    });
    expect(screen.getByRole("button", { name: "Opening Microsoft…" })).toBeDisabled();
    expect(screen.getByRole("button", GOOGLE)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Email me a link" })).toBeDisabled();
  });

  it("says Microsoft is not set up when its start answers 404", async () => {
    providers = { google: true, microsoft: true };
    social.mockResolvedValue({ data: null, error: { status: 404, code: "PROVIDER_NOT_FOUND" } });
    const user = userEvent.setup();
    render(<SignInPage />);
    await user.click(await screen.findByRole("button", MICROSOFT));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Microsoft sign-in is not set up here. Use the email link below.",
    );
    expect(screen.getByRole("button", MICROSOFT)).toBeEnabled();
  });

  it("names Microsoft in a failed Microsoft round trip and keeps Google's copy otherwise", () => {
    for (const [code, text] of [
      ["access_denied", "Microsoft sign-in was cancelled. Try again, or use the email link below."],
      [
        "unable_to_get_user_info",
        "Microsoft could not confirm the email address on that account. Use the email link below.",
      ],
      [
        "account_not_linked",
        "We could not match that Microsoft account to your account. Use the email link below.",
      ],
      ["state_mismatch", "Your Microsoft sign-in took too long or was interrupted. Try again."],
      ["INVALID_TOKEN", EXPIRED],
    ] as const) {
      expect(signInErrorMessage(code, "microsoft")).toBe(text);
    }
    expect(signInErrorMessage("access_denied")).toBe(
      "Google sign-in was cancelled. Try again, or use the email link below.",
    );
    search = { error: "unable_to_get_user_info", via: "microsoft" };
    render(<SignInPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Microsoft could not confirm the email");
  });

  it("helpers: errorCallbackUrl adds via=microsoft only for Microsoft", () => {
    expect(errorCallbackUrl("https://app.example", "/x", "microsoft")).toBe(
      "https://app.example/sign-in?redirect=%2Fx&via=microsoft",
    );
  });

  it("helpers: signInErrorMessage never reads the object prototype", () => {
    for (const code of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(signInErrorMessage(code)).toBe("We could not sign you in. Request a new link below.");
    }
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
    expect(errorCallbackUrl("http://a", undefined)).toBe("http://a/sign-in?redirect=%2F");
    expect(errorCallbackUrl("http://a", "/dev/jobs?jobId=1")).toBe(
      "http://a/sign-in?redirect=%2Fdev%2Fjobs%3FjobId%3D1",
    );
    // A stale error on the redirect is not re-encoded into the next error callback either.
    expect(errorCallbackUrl("http://a", "/?error=INVALID_TOKEN")).toBe(
      "http://a/sign-in?redirect=%2F",
    );
  });
});
