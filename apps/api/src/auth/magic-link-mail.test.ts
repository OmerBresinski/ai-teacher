import { describe, expect, test } from "bun:test";
import {
  confirmPageUrl,
  MAGIC_LINK_EXPIRES_IN_SECONDS,
  MAGIC_LINK_SUBJECT,
  magicLinkHtml,
  magicLinkMail,
  magicLinkText,
} from "./magic-link-mail";

const url =
  "https://api.test/auth/magic-link/verify?token=abc&callbackURL=https%3A%2F%2Fapp.test%2F";

describe("magicLinkMail", () => {
  test("text carries the raw URL and the reason for the email", () => {
    const text = magicLinkText(url);
    expect(text).toContain(url);
    expect(text).toContain("It expires in 15 minutes.");
    expect(text).toContain("You can ignore this email");
  });

  test("html escapes the URL in the button and carries no second link", () => {
    const html = magicLinkHtml(url, "https://api.test/");
    const escaped = url.replaceAll("&", "&amp;");
    expect(html.split(`href="${escaped}"`)).toHaveLength(2);
    expect(html).not.toContain(`href="${url}"`);
    expect(html).toContain("Sign in to DayBack");
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('src="https://api.test/mail-assets/arrow-up-right.png"');
  });

  test("html heads with the DayBack lockup, not the old name", () => {
    const html = magicLinkHtml(url, "https://api.test/");
    expect(html).toContain('src="https://api.test/mail-assets/dayback-mark.png"');
    expect(html).toContain(">DayBack</td>");
    expect(html).not.toContain("Teaching");
  });

  test("html does not let markup through the URL", () => {
    const html = magicLinkHtml('https://x.test/?a="><script>alert(1)</script>', "https://api.test");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("bundle", () => {
    const m = magicLinkMail(url, "https://api.test");
    expect(m.subject).toBe(MAGIC_LINK_SUBJECT);
    expect(m.text).toContain(url);
    expect(m.html).toContain("<!doctype html>");
  });
});

describe("15-minute copy (TEACH-246)", () => {
  test("text, preheader and body all say 15 minutes and match the expiry", () => {
    expect(MAGIC_LINK_EXPIRES_IN_SECONDS).toBe(15 * 60);
    const { text, html } = magicLinkMail(url, "https://api.test");
    expect(text).toContain("It expires in 15 minutes.");
    expect(html).toContain("Your sign-in link, valid for 15 minutes.");
    expect(html).toContain("It expires in 15&nbsp;minutes.");
    expect(`${text}${html}`).not.toMatch(/\b5(&nbsp;| )minutes/);
  });
});

describe("confirmPageUrl (TEACH-246)", () => {
  const verify =
    "https://api.test/auth/magic-link/verify?token=tok123&callbackURL=https%3A%2F%2Fapp.test%2Flessons%2Fnew%3Ftopic%3DThe%2Bcycle&errorCallbackURL=https%3A%2F%2Fapp.test%2Fsign-in%3Fredirect%3D%252F&newUserCallbackURL=https%3A%2F%2Fapp.test%2Fwelcome";
  const trusted = (origin: string) =>
    origin === "https://app.test" || origin === "https://pr.app.test";

  test("points at the web confirm page with the token and both callbacks, never the api", () => {
    const link = new URL(confirmPageUrl(verify, "https://fallback.test", trusted));
    expect(link.origin).toBe("https://app.test");
    expect(link.pathname).toBe("/sign-in/confirm");
    expect(link.searchParams.get("token")).toBe("tok123");
    expect(link.searchParams.get("callbackURL")).toBe(
      "https://app.test/lessons/new?topic=The+cycle",
    );
    expect(link.searchParams.get("errorCallbackURL")).toBe("https://app.test/sign-in?redirect=%2F");
    expect(link.searchParams.has("newUserCallbackURL")).toBe(false);
  });

  test("untrusted callbacks never reach the link: `/` and no error callback", () => {
    const evil = verify.replaceAll("app.test", "evil.test");
    expect(confirmPageUrl(evil, "https://fallback.test", trusted)).toBe(
      "https://fallback.test/sign-in/confirm?token=tok123&callbackURL=%2F",
    );
    const mixed =
      "https://api.test/auth/magic-link/verify?token=t&callbackURL=https%3A%2F%2Fapp.test%2Flessons&errorCallbackURL=javascript%3Aalert(1)";
    expect(confirmPageUrl(mixed, "https://fallback.test", trusted)).toBe(
      "https://app.test/sign-in/confirm?token=t&callbackURL=https%3A%2F%2Fapp.test%2Flessons",
    );
    const protocolRelative =
      "https://api.test/auth/magic-link/verify?token=t&callbackURL=%2F%2Fevil.test%2F&errorCallbackURL=%2Fsign-in";
    expect(confirmPageUrl(protocolRelative, "https://fallback.test", trusted)).toBe(
      "https://fallback.test/sign-in/confirm?token=t&callbackURL=%2F&errorCallbackURL=%2Fsign-in",
    );
  });

  test("a relative callback falls back to the configured web origin", () => {
    const relative = "https://api.test/auth/magic-link/verify?token=t&callbackURL=%2F";
    expect(confirmPageUrl(relative, "https://fallback.test", trusted)).toBe(
      "https://fallback.test/sign-in/confirm?token=t&callbackURL=%2F",
    );
  });

  test("a trusted preview origin keeps its own confirm page", () => {
    const preview = verify.replaceAll("https%3A%2F%2Fapp.test", "https%3A%2F%2Fpr.app.test");
    expect(new URL(confirmPageUrl(preview, "https://app.test", trusted)).origin).toBe(
      "https://pr.app.test",
    );
  });
});
