import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { Slide } from "@tj/domain/documents";
import { ImageOriginProvider } from "../images/image-origin";
import { getTheme } from "../model/themes";
import { SlideView } from "./SlideView";

/* TEACH-275 row 5: stored `/files/<key>` paths resolve against the api origin at render. */

afterEach(cleanup);

const theme = getTheme("chalk");
const slide: Slide = {
  id: "s1",
  kind: "content",
  background: { image: "/files/ws/bg.png" },
  elements: [
    { id: "i1", type: "image", x: 0, y: 0, w: 400, h: 300, src: "/files/ws/a.png", fit: "cover" },
    {
      id: "i2",
      type: "image",
      x: 0,
      y: 0,
      w: 400,
      h: 300,
      src: "https://other/x.png",
      fit: "cover",
    },
    {
      id: "g1",
      type: "group",
      x: 0,
      y: 0,
      w: 400,
      h: 300,
      children: [
        {
          id: "i3",
          type: "image",
          x: 0,
          y: 0,
          w: 100,
          h: 100,
          src: "/files/ws/c.png",
          fit: "cover",
        },
      ],
    },
  ],
} as Slide;

const srcs = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("img")).map((img) => img.getAttribute("src"));

describe("SlideView image origin", () => {
  test("resolves elements, group children and the background from the prop", () => {
    const { container } = render(
      <SlideView slide={slide} theme={theme} mode="thumb" imageOrigin="https://api.x/" />,
    );
    expect(srcs(container)).toEqual([
      "https://api.x/files/ws/a.png",
      "https://other/x.png",
      "https://api.x/files/ws/c.png",
    ]);
    const bg = container.querySelector<HTMLElement>("[data-background-image]");
    expect(bg?.dataset.backgroundImage).toBe("https://api.x/files/ws/bg.png");
    expect(bg?.style.backgroundImage).toBe('url("https://api.x/files/ws/bg.png")');
  });

  test("inherits the origin from an ImageOriginProvider above it", () => {
    const { container } = render(
      <ImageOriginProvider origin="/api">
        <SlideView slide={slide} theme={theme} mode="thumb" />
      </ImageOriginProvider>,
    );
    expect(srcs(container)[0]).toBe("/api/files/ws/a.png");
  });

  test("renders the stored path bare when there is no origin at all", () => {
    const { container } = render(<SlideView slide={slide} theme={theme} mode="thumb" />);
    expect(srcs(container)[0]).toBe("/files/ws/a.png");
  });
});
