import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { ImageElement } from "@tj/domain/documents";
import { getTheme } from "../../model/themes";
import { ImageView } from "./ImageView";

/* TEACH-153: a crop implies Fill, so the bitmap is never letterboxed under a window. */

afterEach(cleanup);

const theme = getTheme("chalk");
const base: ImageElement = {
  id: "i1",
  type: "image",
  x: 0,
  y: 0,
  w: 400,
  h: 300,
  src: "data:,",
  fit: "contain",
};

const imgOf = (element: ImageElement) => {
  const { container } = render(
    <ImageView
      element={element}
      theme={theme}
      mode="edit"
      slideId="s1"
      hidden={false}
      ghost={false}
      revealAnswer={false}
    />,
  );
  const img = container.querySelector("img");
  if (!img) throw new Error("no img");
  return img;
};

describe("ImageView", () => {
  test("Fit without adjustments renders contain", () => {
    expect(imgOf(base).style.objectFit).toBe("contain");
  });

  test("a crop, focal point or transform renders cover whatever `fit` says", () => {
    expect(imgOf({ ...base, crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }).style.objectFit).toBe(
      "cover",
    );
    expect(imgOf({ ...base, focal: { x: 0.2, y: 0.8 } }).style.objectFit).toBe("cover");
    expect(imgOf({ ...base, imageTransform: { rotate: 90 } }).style.objectFit).toBe("cover");
  });
});
