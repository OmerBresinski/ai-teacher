import { describe, expect, test } from "bun:test";
import { svgDrawsSomething } from "./index";

const url = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

describe("svgDrawsSomething (TEACH-247 part bd)", () => {
  test("a drawing whose marks sit at the top level, with no group, draws (Rivers v417 s6)", () => {
    const river =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 348 284"><path d="M74,236 L74,198 L174,102"/><circle cx="10" cy="10" r="4"/></svg>';
    expect(svgDrawsSomething(url(river))).toBe(true);
  });
  test("a title alone still draws nothing, with or without a group", () => {
    expect(
      svgDrawsSomething(url('<svg><title>A river</title><text x="0" y="10">A river</text></svg>')),
    ).toBe(false);
    expect(
      svgDrawsSomething(url("<svg><title>A river</title><text>A river</text><g></g></svg>")),
    ).toBe(false);
  });
  test("a group with marks still draws", () => {
    expect(
      svgDrawsSomething(url('<svg><text>Title</text><g><rect width="2" height="2"/></g></svg>')),
    ).toBe(true);
  });
});
