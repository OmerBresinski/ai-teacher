import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ImageElement, Slide } from "@tj/domain/documents";
import type { ImageSearchClient } from "../../images/image-search";
import { uid } from "../../model/factories";
import { getTheme } from "../../model/themes";
import { SlideView } from "../../slide/SlideView";
import { catcher, nextFrame, pointer, renderEditor, seededLesson } from "../test-harness";

/*
 * TEACH-158 rows 9-13: the "i" badge on a selected image shows provenance (or legacy credit),
 * hides while dragging, and never renders outside the editor canvas.
 */

afterEach(cleanup);

const source = {
  provider: "pexels",
  id: "a",
  pageUrl: "https://www.pexels.com/photo/a/",
  photographer: "Ada",
  photographerUrl: "https://www.pexels.com/@ada",
} as const;

const image = (overrides: Partial<ImageElement> = {}): ImageElement => ({
  id: uid(),
  type: "image",
  x: 100,
  y: 80,
  w: 300,
  h: 200,
  src: "https://example.test/a.jpg",
  fit: "contain",
  ...overrides,
});

function seededImage(el: ImageElement) {
  const lesson = seededLesson();
  const first = lesson.slides[0];
  if (first) first.elements = [el];
  return lesson;
}

async function selectImage(container: HTMLElement) {
  fireEvent.pointerDown(catcher(container), pointer(200, 150));
  fireEvent.pointerUp(window, pointer(200, 150));
  return screen.findByRole("button", { name: "Image credit" });
}

describe("ImageCreditBadge", () => {
  test("a sourced image shows the badge with photographer and Pexels links", async () => {
    const { container } = renderEditor(seededImage(image({ source: { ...source } })));
    const badge = await selectImage(container);
    expect(badge).toBeTruthy();

    fireEvent.click(badge);
    expect(await screen.findByText(/Photo by/)).toBeTruthy();
    const photographer = screen.getByRole("link", { name: "Ada" });
    expect(photographer.getAttribute("href")).toBe("https://www.pexels.com/@ada");
    expect(photographer.getAttribute("target")).toBe("_blank");
    const pexels = screen.getByRole("link", { name: "Pexels" });
    expect(pexels.getAttribute("href")).toBe("https://www.pexels.com/photo/a/");

    // Deselect removes it.
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Image credit" })).toBeNull());
  });

  test("a credit-only image shows the credit text and the original link", async () => {
    const { container } = renderEditor(
      seededImage(image({ credit: "Old by Someone, CC0", creditUrl: "https://example.test/o" })),
    );
    const badge = await selectImage(container);
    fireEvent.click(badge);
    expect(await screen.findByText("Old by Someone, CC0")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View the original" }).getAttribute("href")).toBe(
      "https://example.test/o",
    );
  });

  test("an image with neither shows no badge", async () => {
    const { container } = renderEditor(seededImage(image()));
    fireEvent.pointerDown(catcher(container), pointer(200, 150));
    fireEvent.pointerUp(window, pointer(200, 150));
    await screen.findByRole("toolbar", { name: "Image" });
    expect(screen.queryByRole("button", { name: "Image credit" })).toBeNull();
  });

  test("the badge hides while a drag is in flight", async () => {
    const { container } = renderEditor(seededImage(image({ source: { ...source } })));
    await selectImage(container);
    // Begin a move and stop before release: the gesture preview is live.
    fireEvent.pointerDown(catcher(container), pointer(200, 150));
    fireEvent.pointerMove(window, pointer(220, 150));
    await act(nextFrame);
    expect(screen.queryByRole("button", { name: "Image credit" })).toBeNull();
    fireEvent.pointerUp(window, pointer(220, 150));
    await screen.findByRole("button", { name: "Image credit" });
  });

  test("reporting a placed picture calls report with the lesson id and changes nothing", async () => {
    const report = mock(async (_input: unknown) => {});
    const images = { report } as unknown as ImageSearchClient;
    const lesson = seededImage(image({ source: { ...source } }));
    const { container, read } = renderEditor(lesson, { images });
    const badge = await selectImage(container);
    fireEvent.click(badge);
    const trigger = await screen.findByRole("button", { name: "Report this image" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    const item = await screen.findByRole("menuitem", { name: "Wrong subject" });
    fireEvent.click(item);

    await waitFor(() => expect(report).toHaveBeenCalledTimes(1));
    expect(report.mock.calls[0]?.[0]).toEqual({
      photo: { provider: "pexels", id: "a" },
      reason: "wrong-subject",
      context: "placed",
      lessonId: lesson.id,
    });
    const el = read().slides[0]?.elements[0];
    expect(el?.type === "image" && el.src).toBe("https://example.test/a.jpg");
  });

  test("without a client the badge has no report item", async () => {
    const { container } = renderEditor(seededImage(image({ source: { ...source } })));
    const badge = await selectImage(container);
    fireEvent.click(badge);
    await screen.findByText(/Photo by/);
    expect(screen.queryByRole("button", { name: "Report this image" })).toBeNull();
  });

  test("SlideView in view, present, thumb and capture modes renders no badge", () => {
    const slide: Slide = {
      id: uid(),
      kind: "content",
      elements: [image({ source: { ...source } })],
    };
    const theme = getTheme("playground");
    for (const mode of ["view", "present", "thumb", "capture"] as const) {
      const { unmount } = render(<SlideView slide={slide} theme={theme} mode={mode} />);
      expect(screen.queryByRole("button", { name: "Image credit" })).toBeNull();
      unmount();
    }
  });
});
