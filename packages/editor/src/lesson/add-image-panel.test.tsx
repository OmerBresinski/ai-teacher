import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ImageElement } from "@tj/domain/documents";
import { RATE_LIMITED_MESSAGE, SEARCH_FAILED_MESSAGE } from "../images/ImagePicker";
import type { ImageSearchClient, PhotoResult, PickedPhoto } from "../images/image-search";
import { SearchError } from "../images/image-search";
import { uid } from "../model/factories";
import { catcher, pointer, renderEditor, seededLesson } from "./test-harness";

/*
 * TEACH-158 rows 1-8: the Add image panel opens from the rail button and the `i` key on the
 * Upload tab with no GIFs tab; the Photos tab searches Pexels through the injected client,
 * picks call `POST /images/pick` through it, Replace flips `authoredBy` and an upload clears
 * provenance. Esc closes; without a client the Photos tab says so.
 */

const toastSpy = mock((..._args: unknown[]) => {});
const actualUi = await import("@tj/ui");
mock.module("@tj/ui", () => ({ ...actualUi, toast: toastSpy }));

afterEach(() => {
  cleanup();
  toastSpy.mockReset();
});

const rail = () => screen.getByRole("toolbar", { name: "Insert" });
const imageButton = () => within(rail()).getByRole("button", { name: "Image" });
const panel = () => screen.queryByRole("dialog", { name: /Add image|Replace image/ });
const canvas = () => screen.getByRole("group", { name: "Slide canvas" });

const photoSource = {
  provider: "pexels",
  id: "a",
  pageUrl: "https://www.pexels.com/photo/a/",
  photographer: "Ada",
  photographerUrl: "https://www.pexels.com/@ada",
} as const;

const pexelsPhoto = (id: string, alt = `Photo ${id}`): PhotoResult => ({
  id,
  width: 6000,
  height: 4000,
  alt,
  photographer: "Ada",
  photographerUrl: "https://www.pexels.com/@ada/",
  pageUrl: `https://www.pexels.com/photo/${id}/`,
  src: {
    large: `https://images.pexels.com/photos/${id}/large.jpeg`,
    medium: `https://images.pexels.com/photos/${id}/medium.jpeg`,
    tiny: `https://images.pexels.com/photos/${id}/tiny.jpeg`,
  },
});

const pickedPhoto = (id: string): PickedPhoto => ({
  url: `/files/ws/images/${id}.jpg`,
  width: 6000,
  height: 4000,
  source: { ...photoSource, id, pageUrl: `https://www.pexels.com/photo/${id}/` },
});

function fakeClient(page: { photos: PhotoResult[]; nextPage: number | null }): {
  client: ImageSearchClient;
  search: ReturnType<typeof mock>;
  pick: ReturnType<typeof mock>;
} {
  const search = mock(async (_query: string, _opts: unknown) => page);
  const pick = mock(async (photo: PhotoResult) => pickedPhoto(photo.id));
  return { client: { search, pick } as ImageSearchClient, search, pick };
}

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
const selectFirstImage = async (container: HTMLElement) => {
  fireEvent.pointerDown(catcher(container), pointer(200, 150));
  fireEvent.pointerUp(window, pointer(200, 150));
  const toolbar = await screen.findByRole("toolbar", { name: "Image" });
  return toolbar;
};
const replaceVia = async (container: HTMLElement) => {
  const toolbar = await selectFirstImage(container);
  fireEvent.click(within(toolbar).getByRole("button", { name: "Replace" }));
  expect(await screen.findByRole("dialog", { name: "Replace image" })).toBeTruthy();
};

const seededImage = (overrides: Partial<ImageElement> = {}): ImageElement => ({
  id: uid(),
  type: "image",
  x: 100,
  y: 80,
  w: 300,
  h: 200,
  src: "https://example.test/old.jpg",
  fit: "contain",
  ...overrides,
});

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

  test("Photos: searches once with landscape orientation and shows tiles by alt", async () => {
    const { client, search: searchMock } = fakeClient({
      photos: [pexelsPhoto("a", "River"), pexelsPhoto("b", "")],
      nextPage: 2,
    });
    renderEditor(seededLesson(), { images: client });
    fireEvent.click(imageButton());
    await photosTab();
    await search("river");

    expect(await screen.findByRole("button", { name: "River" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Photo by Ada" })).toBeTruthy();
    expect(searchMock).toHaveBeenCalledTimes(1);
    const [query, opts] = searchMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(query).toBe("river");
    expect(opts.orientation).toBe("landscape");
    expect(opts.page).toBe(1);
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
  });

  test("Photos: Load more fetches the next page", async () => {
    const { client, search: searchMock } = fakeClient({ photos: [pexelsPhoto("a")], nextPage: 2 });
    renderEditor(seededLesson(), { images: client });
    fireEvent.click(imageButton());
    await photosTab();
    await search("river");
    await screen.findByRole("button", { name: "Photo a" });
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(2));
    const [, opts] = searchMock.mock.calls[1] as [string, Record<string, unknown>];
    expect(opts.page).toBe(2);
  });

  test("Photos: clicking a tile picks it into a new element with source", async () => {
    const { client, pick } = fakeClient({ photos: [pexelsPhoto("a", "River")], nextPage: null });
    const { read } = renderEditor(seededLesson(), { images: client });
    fireEvent.click(imageButton());
    await photosTab();
    await search("river");
    fireEvent.click(await screen.findByRole("button", { name: "River" }));

    await waitFor(() => {
      const elements = read().slides[0]?.elements ?? [];
      expect(elements).toHaveLength(3);
    });
    expect(pick).toHaveBeenCalledTimes(1);
    const el = read().slides[0]?.elements[2] as ImageElement;
    expect(el.src).toBe("/files/ws/images/a.jpg");
    expect(el.alt).toBe("River");
    expect(el.source).toEqual({ ...photoSource, pageUrl: "https://www.pexels.com/photo/a/" });
    expect(el).not.toHaveProperty("credit");
    expect(el).not.toHaveProperty("authoredBy");
    await waitFor(() => expect(panel()).toBeNull());
  });

  test("Replace over a credited image sets source and flips authoredBy, keeping id and frame", async () => {
    const { client } = fakeClient({ photos: [pexelsPhoto("n", "New")], nextPage: null });
    const lesson = seededLesson();
    const image = seededImage({
      credit: "Old by Someone, CC0",
      creditUrl: "https://example.test/o",
    });
    const first = lesson.slides[0];
    if (first) first.elements = [image];
    const { container, read } = renderEditor(lesson, { images: client });

    await replaceVia(container);
    await photosTab();
    await search("new");
    fireEvent.click(await screen.findByRole("button", { name: "New" }));

    await waitFor(() => {
      const el = read().slides[0]?.elements[0] as ImageElement | undefined;
      expect(el?.src).toBe("/files/ws/images/n.jpg");
    });
    const el = read().slides[0]?.elements[0] as ImageElement;
    expect(el).toMatchObject({
      id: image.id,
      x: 100,
      y: 80,
      w: 300,
      h: 200,
      alt: "New",
      authoredBy: "teacher",
    });
    expect(el.source?.id).toBe("n");
    expect(el.credit).toBeUndefined();
    expect(el.creditUrl).toBeUndefined();
    expect(read().slides[0]?.elements).toHaveLength(1);
    await waitFor(() => expect(panel()).toBeNull());
  });

  test("Replace over a sourced image with an upload clears provenance and flips authoredBy", async () => {
    const { client } = fakeClient({ photos: [], nextPage: null });
    const lesson = seededLesson();
    const image = seededImage({ source: { ...photoSource } });
    const first = lesson.slides[0];
    if (first) first.elements = [image];
    const { container, read } = renderEditor(lesson, { images: client });

    await replaceVia(container);
    const file = new File(["<svg xmlns='http://www.w3.org/2000/svg'/>"], "x.svg", {
      type: "image/svg+xml",
    });
    const input = screen.getByLabelText("Image file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      const el = read().slides[0]?.elements[0] as ImageElement | undefined;
      expect(el?.src.startsWith("data:image/svg+xml")).toBe(true);
    });
    const el = read().slides[0]?.elements[0] as ImageElement;
    expect(el.id).toBe(image.id);
    expect(el.authoredBy).toBe("teacher");
    expect(el.source).toBeUndefined();
    expect(el.credit).toBeUndefined();
    expect(el.creditUrl).toBeUndefined();
  });

  test("a 429 search shows the rate-limit line with Retry; a 500 shows the failure line", async () => {
    let status = 429;
    const searchMock = mock(async (): Promise<never> => {
      throw new SearchError("Slow", status);
    });
    const pickMock = mock(async (photo: PhotoResult) => pickedPhoto(photo.id));
    renderEditor(seededLesson(), {
      images: { search: searchMock, pick: pickMock } as ImageSearchClient,
    });
    fireEvent.click(imageButton());
    await photosTab();
    await search("river");

    expect(await screen.findByText(RATE_LIMITED_MESSAGE)).toBeTruthy();
    status = 500;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(SEARCH_FAILED_MESSAGE)).toBeTruthy();
  });

  test("a failed pick toasts, adds nothing and clears the spinner", async () => {
    const searchMock = mock(async () => ({ photos: [pexelsPhoto("a", "River")], nextPage: null }));
    const pickMock = mock(async (): Promise<never> => {
      throw new SearchError("Down", 503);
    });
    const { read } = renderEditor(seededLesson(), {
      images: { search: searchMock, pick: pickMock } as ImageSearchClient,
    });
    fireEvent.click(imageButton());
    await photosTab();
    await search("river");
    const tile = await screen.findByRole("button", { name: "River" });
    fireEvent.click(tile);

    await waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(1));
    expect(toastSpy.mock.calls[0]?.[0]).toBe(SEARCH_FAILED_MESSAGE);
    expect(read().slides[0]?.elements).toHaveLength(2);
    await waitFor(() => expect(tile).not.toBeDisabled());
  });

  test("without a client the Photos tab says search is unavailable", async () => {
    renderEditor();
    fireEvent.click(imageButton());
    await photosTab();
    expect(await screen.findByText("Photo search is not available.")).toBeTruthy();
    expect(screen.queryByRole("searchbox", { name: "Search images" })).toBeNull();
  });
});
