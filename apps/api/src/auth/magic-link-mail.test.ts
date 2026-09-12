import { describe, expect, test } from "bun:test";
import { MAGIC_LINK_SUBJECT, magicLinkHtml, magicLinkMail, magicLinkText } from "./magic-link-mail";

const url =
  "https://api.test/auth/magic-link/verify?token=abc&callbackURL=https%3A%2F%2Fapp.test%2F";

describe("magicLinkMail", () => {
  test("text carries the raw URL and the reason for the email", () => {
    const text = magicLinkText(url);
    expect(text).toContain(url);
    expect(text).toContain("expires in 5 minutes");
    expect(text).toContain("You can ignore this email");
  });

  test("html escapes the URL in the button and carries no second link", () => {
    const html = magicLinkHtml(url, "https://api.test/");
    const escaped = url.replaceAll("&", "&amp;");
    expect(html.split(`href="${escaped}"`)).toHaveLength(2);
    expect(html).not.toContain(`href="${url}"`);
    expect(html).toContain("Sign in to Teaching Journey");
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('src="https://api.test/mail-assets/arrow-up-right.png"');
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
