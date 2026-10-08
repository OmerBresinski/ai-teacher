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

/* TEACH-247 part b: a drawn diagram's builds, one per Next in Present only. */
describe("ImageView diagram builds", () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect/><g data-s="1"><circle/></g><g data-s="2"><path/></g><g data-ans="1"><text>9</text></g></svg>';
  const diagram: ImageElement = {
    ...base,
    name: "Diagram",
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    builds: 2,
  };
  const shown = (props: Partial<Parameters<typeof ImageView>[0]>) => {
    const { container } = render(
      <ImageView
        element={diagram}
        theme={theme}
        mode="present"
        slideId="s1"
        hidden={false}
        ghost={false}
        revealAnswer={false}
        {...props}
      />,
    );
    const src = container.querySelector("img")?.getAttribute("src") ?? "";
    cleanup();
    return decodeURIComponent(src.split(",")[1] ?? "");
  };

  test("present hides the builds still to come; the last build shows everything", () => {
    expect(shown({ diagramBuild: 0 })).toContain('[data-s="1"],[data-s="2"]{opacity:0}');
    expect(shown({ diagramBuild: 1 })).toContain('[data-s="2"]{opacity:0}');
    const last = shown({ diagramBuild: 2 });
    expect(last).not.toContain("{opacity:0}");
    // The newest build rises in (no reduced-motion preference in the test DOM).
    expect(last).toContain('[data-s="2"]{animation');
  });

  test("on a question slide the answer part waits for the reveal", () => {
    const q = { type: "open-response" as const, modelAnswer: "9" };
    expect(shown({ diagramBuild: 2, question: q })).toContain('[data-ans="1"]{opacity:0}');
    expect(shown({ diagramBuild: 2, question: q, revealAnswer: true })).not.toContain(
      "{opacity:0}",
    );
  });

  test("the editor, thumbnails and capture show the stored drawing as it is", () => {
    for (const mode of ["edit", "thumb", "capture"] as const)
      expect(shown({ mode, diagramBuild: undefined })).toBe(svg);
  });
});
