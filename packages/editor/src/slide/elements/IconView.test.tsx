import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { IconElement } from "@tj/domain/documents";
import { getTheme } from "../../model/themes";
import { IconView } from "./IconView";

/* TEACH-310 part b: an icon with a library `concept` draws the drawn illustration. */

afterEach(cleanup);

const theme = getTheme("splash");
const base: IconElement = { id: "ic", type: "icon", icon: "sparkles", x: 0, y: 0, w: 120, h: 120 };

const view = (element: IconElement) =>
  render(
    <IconView
      element={element}
      theme={theme}
      mode="edit"
      slideId="s1"
      hidden={false}
      ghost={false}
      revealAnswer={false}
    />,
  ).container;

const decoded = (img: HTMLImageElement) =>
  decodeURIComponent(
    img.getAttribute("src")?.replace(/^data:image\/svg\+xml;charset=utf-8,/, "") ?? "",
  );

describe("IconView with a library concept", () => {
  test("draws the library SVG in literal colours, not a lucide glyph", async () => {
    const el = view({ ...base, concept: "heart" });
    const img = await waitFor(() => {
      const found = el.querySelector("img");
      if (!found) throw new Error("not drawn yet");
      return found;
    });
    const svg = decoded(img);
    expect(svg).toContain('viewBox="0 0 240 240"');
    expect(svg).not.toContain("var(");
    expect(img.getAttribute("alt")).toBe("");
    expect(el.querySelector("svg.lucide")).toBeNull();
  });

  test("an unknown concept draws the lucide icon and does not throw", async () => {
    const el = view({ ...base, concept: "kitten" });
    await new Promise((r) => setTimeout(r, 50));
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("svg.lucide")).not.toBeNull();
  });

  test("no concept: the lucide icon as before", () => {
    const el = view(base);
    expect(el.querySelector("svg.lucide")).not.toBeNull();
    expect(el.querySelector("img")).toBeNull();
  });
});
