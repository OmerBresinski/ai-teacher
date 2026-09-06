import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ImageElement } from "@tj/domain/documents";
import { uid } from "../model/factories";
import { RATE_LIMITED_MESSAGE, SEARCH_FAILED_MESSAGE } from "./AddImagePanel";
import { catcher, pointer, renderEditor, seededLesson } from "./test-harness";

/*
 * TEACH-107 rows 1 and 8: the Add image panel opens from the rail button and the `i` key on the
 * Upload tab with no GIFs tab, Esc closes it; the Photos tab runs an Openverse search through a
 * mocked `fetch`, shows the credit on each tile, says why a search failed and retries. Replace mode
 * (row 9) swaps the fields on the selected image and keeps its frame.
 */

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const realFetch = globalThis.fetch;
const rail = () => screen.getByRole("toolbar", { name: "Insert" });
const imageButton = () => within(rail()).getByRole("button", { name: "Image" });
const panel = () => screen.queryByRole("dialog", { name: /Add image|Replace image/ });
const canvas = () => screen.getByRole("group", { name: "Slide canvas" });

const row = (id: string, title: string) => ({
  id,
  title,
  url: `https://example.test/${id}.jpg`,
  thumbnail: `https://example.test/${id}-thumb.jpg`,
  creator: "Ada",
  license: "by",
  license_version: "2.0",
  foreign_landing_url: `https://example.test/pages/${id}`,
  width: 1200,
  height: 800,
});

const stubFetch = (answer: (url: string) => Promise<unknown>) => {
  const fetcher = mock((input: unknown) => answer(String(input)));
  globalThis.fetch = fetcher as unknown as typeof fetch;
  return fetcher;
};
const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

/** Type into the search field and press Enter, so the search runs without the debounce. */
const search = async (term: string) => {
  const field = await screen.findByRole("searchbox", { name: "Search images" });
  fireEvent.change(field, { target: { value: term } });
  fireEvent.keyDown(field, { key: "Enter" });
};
const photosTab = async () => {
  const tab = await screen.findByRole("tab", { name: "Photos" });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
};

describe("AddImagePanel", () => {
  test("opens on Upload from the rail button and the i key, with no GIFs tab; Esc closes", async () => {
    renderEditor();
    fireEvent.click(imageButton());
    const dialog = await screen.findByRole("dialog", { name: "Add image" });
    expect(within(dialog).getByRole("tab", { name: "Upload", selected: true })).toBeTruthy();
    expect(within(dialog).getByRole("tab", { name: "Photos" })).toBeTruthy();
    expect(within(dialog).queryByRole("tab", { name: /GIF/i })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Choose file" })).toBeTruthy();

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(panel()).toBeNull());

    // `i` while the canvas has focus opens the same panel.
    fireEvent.focus(canvas());
    fireEvent.keyDown(window, { key: "i" });
    expect(await screen.findByRole("dialog", { name: "Add image" })).toBeTruthy();
  });

  test("Photos: searches Openverse and shows each result with its credit", async () => {
    const fetcher = stubFetch(async () =>
      okJson({ page_count: 1, results: [row("a", "River"), row("b", "Delta")] }),
    );
    renderEditor();
    fireEvent.click(imageButton());
    await photosTab();
    await search("river");

    const tile = await screen.findByRole("button", { name: "River by Ada, CC BY 2.0" });
    expect(tile).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delta by Ada, CC BY 2.0" })).toBeTruthy();
    const asked = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(asked.origin + asked.pathname).toBe("https://api.openverse.org/v1/images/");
    expect(asked.searchParams.get("q")).toBe("river");
  });

  test("Photos: a 500 shows the failure copy and Retry runs the search again; 429 has its own line", async () => {
    let status = 500;
    stubFetch(async () => ({ ok: false, status }));
    renderEditor();
    fireEvent.click(imageButton());
    await photosTab();
    await search("river");

    expect(await screen.findByText(SEARCH_FAILED_MESSAGE)).toBeTruthy();
    status = 429;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(RATE_LIMITED_MESSAGE)).toBeTruthy();
  });

  test("Replace swaps src, alt and credit on the selected image and keeps its frame", async () => {
    const lesson = seededLesson();
    const image: ImageElement = {
      id: uid(),
      type: "image",
      x: 100,
      y: 80,
      w: 300,
      h: 200,
      src: "https://example.test/old.jpg",
      fit: "contain",
      credit: "Old by Someone, CC0",
    };
    const first = lesson.slides[0];
    if (first) first.elements = [image];
    stubFetch(async (url) =>
      url.startsWith("https://api.openverse.org/")
        ? okJson({ page_count: 1, results: [row("n", "New")] })
        : // The full-size fetch refuses CORS, so the remote URL is written as a link.
          Promise.reject(new TypeError("Failed to fetch")),
    );
    const { container, read } = renderEditor(lesson);

    // Select the image on the canvas (client points equal slide points under the harness).
    fireEvent.pointerDown(catcher(container), pointer(200, 150));
    fireEvent.pointerUp(window, pointer(200, 150));
    const toolbar = await screen.findByRole("toolbar", { name: "Image" });
    fireEvent.click(within(toolbar).getByRole("button", { name: "Replace" }));
    expect(await screen.findByRole("dialog", { name: "Replace image" })).toBeTruthy();

    await photosTab();
    await search("new");
    fireEvent.click(await screen.findByRole("button", { name: "New by Ada, CC BY 2.0" }));

    await waitFor(() => {
      const el = read().slides[0]?.elements[0] as ImageElement | undefined;
      expect(el?.src).toBe("https://example.test/n.jpg");
    });
    const el = read().slides[0]?.elements[0] as ImageElement;
    expect(el).toMatchObject({
      id: image.id,
      x: 100,
      y: 80,
      w: 300,
      h: 200,
      alt: "New",
      credit: "New by Ada, CC BY 2.0",
      creditUrl: "https://example.test/pages/n",
    });
    expect(read().slides[0]?.elements).toHaveLength(1);
    await waitFor(() => expect(panel()).toBeNull());
  });
});
