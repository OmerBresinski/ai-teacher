import { describe, expect, test } from "bun:test";
import { isLinkableHref, normaliseHref } from "./links";

describe("normaliseHref", () => {
  test("keeps a full address exactly as typed", () => {
    expect(normaliseHref("https://bbc.co.uk/bitesize")).toBe("https://bbc.co.uk/bitesize");
    expect(normaliseHref("http://example.org")).toBe("http://example.org");
    expect(normaliseHref("  https://a.b/c  ")).toBe("https://a.b/c");
  });

  test("gives a bare host https, because that is what a teacher types", () => {
    expect(normaliseHref("bbc.co.uk")).toBe("https://bbc.co.uk");
    expect(normaliseHref("bbc.co.uk/bitesize?x=1")).toBe("https://bbc.co.uk/bitesize?x=1");
  });

  test("takes an email address, or several", () => {
    expect(normaliseHref("mailto:head@school.sch.uk")).toBe("mailto:head@school.sch.uk");
    expect(normaliseHref("mailto:a@b.c,d@e.f")).toBe("mailto:a@b.c,d@e.f");
  });

  test("refuses a mailto with nobody to write to", () => {
    expect(normaliseHref("mailto:")).toBeNull();
    expect(normaliseHref("mailto:not-an-address")).toBeNull();
  });

  test("refuses a path, because a slide has no site to be relative to", () => {
    expect(normaliseHref("/handbook")).toBeNull();
    expect(normaliseHref("//cdn.example.org/x")).toBeNull();
  });

  test("refuses anything that is not a link", () => {
    expect(normaliseHref("")).toBeNull();
    expect(normaliseHref("   ")).toBeNull();
    expect(normaliseHref("javascript:alert(1)")).toBeNull();
    expect(normaliseHref("data:text/html,hi")).toBeNull();
    expect(normaliseHref("ftp://files.example.org")).toBeNull();
    expect(normaliseHref("https://")).toBeNull();
  });
});

describe("isLinkableHref", () => {
  test("http and https only", () => {
    expect(isLinkableHref("example.test/img")).toBe(true);
    expect(isLinkableHref("http://x.y")).toBe(true);
    expect(isLinkableHref("mailto:a@b.c")).toBe(false);
    expect(isLinkableHref("javascript:alert(1)")).toBe(false);
  });
});

describe("isTrustedThumbnail (TEACH-220)", () => {
  test("accepts the provider's CDN over https and inline image data URLs, nothing else", async () => {
    const { isTrustedThumbnail } = await import("./slide");
    expect(isTrustedThumbnail("https://images.pexels.com/photos/1/tiny.jpeg?auto=compress")).toBe(
      true,
    );
    expect(isTrustedThumbnail("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isTrustedThumbnail("http://images.pexels.com/photos/1/tiny.jpeg")).toBe(false);
    expect(isTrustedThumbnail("https://evil.test/images.pexels.com/x.jpg")).toBe(false);
    expect(isTrustedThumbnail("https://images.pexels.com.evil.test/x.jpg")).toBe(false);
    expect(isTrustedThumbnail("data:text/html,<script>")).toBe(false);
    expect(isTrustedThumbnail("/files/ws/x.jpg")).toBe(false);
  });
});
