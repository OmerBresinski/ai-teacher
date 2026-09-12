import { describe, expect, it } from "bun:test";
import { isOwnFile, resolveImageSrc } from "./resolve-src";

/* TEACH-275 rows 1–2. */
describe("resolveImageSrc", () => {
  it("prefixes a relative /files/ path with the origin, tolerating a trailing slash", () => {
    expect(resolveImageSrc("/files/ws/a.png", "https://api.x")).toBe(
      "https://api.x/files/ws/a.png",
    );
    expect(resolveImageSrc("/files/ws/a.png", "https://api.x/")).toBe(
      "https://api.x/files/ws/a.png",
    );
    // The dev proxy path is an origin too.
    expect(resolveImageSrc("/files/ws/a.png", "/api")).toBe("/api/files/ws/a.png");
  });

  it("leaves everything else alone", () => {
    expect(resolveImageSrc("data:image/png;base64,AAAA", "https://api.x")).toBe(
      "data:image/png;base64,AAAA",
    );
    expect(resolveImageSrc("https://other/x.png", "https://api.x")).toBe("https://other/x.png");
    expect(resolveImageSrc("https://api.x/files/a.png", "https://api.x")).toBe(
      "https://api.x/files/a.png",
    );
    expect(resolveImageSrc("/files/a.png", undefined)).toBe("/files/a.png");
    expect(resolveImageSrc("/filesystem/a.png", "https://api.x")).toBe("/filesystem/a.png");
  });
});

describe("isOwnFile", () => {
  it("is true for a relative /files/ path whatever the origin", () => {
    expect(isOwnFile("/files/a.png", "https://api.x")).toBe(true);
    expect(isOwnFile("/files/a.png", undefined)).toBe(true);
  });

  it("is true for an absolute path on the origin, with a path boundary", () => {
    expect(isOwnFile("https://api.x/files/a.png", "https://api.x")).toBe(true);
    expect(isOwnFile("https://api.x/files/a.png", "https://api.x/")).toBe(true);
    expect(isOwnFile("https://api.x.evil/files/a.png", "https://api.x")).toBe(false);
    expect(isOwnFile("https://api.x/files/a.png", undefined)).toBe(false);
  });

  it("is false for third-party and data URLs", () => {
    expect(isOwnFile("https://other/x.png", "https://api.x")).toBe(false);
    expect(isOwnFile("data:image/png;base64,AAAA", "https://api.x")).toBe(false);
  });
});
