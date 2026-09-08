import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { E2E_API_URL } from "../playwright.config";
import { addedElement, elementIds, expect, type SeededPaths, test } from "./fixtures";

/*
 * Images in the lesson editor (TEACH-107 rows 2–4, TEACH-158 rows 5–6, 8–9): upload, paste and
 * drop land a downscaled data-URL image element; the Photos tab searches Pexels through the api
 * (mocked with `page.route` — CI never hits the network), picking copies the rendition into the
 * bucket and stores our `/files` URL with provenance; Replace keeps the element and its frame.
 */

const EDITOR = (paths: SeededPaths) => paths.lesson("demo-water-cycle");
const FIXTURE = fileURLToPath(new URL("./fixtures/photo-3000x2000.png", import.meta.url));
const PNG = readFileSync(FIXTURE);
/** `fileToDataUrl`'s default long edge. */
const MAX_EDGE = 1600;

const elements = (page: Page) => page.locator("[data-slide-frame] [data-element-id]");
const rail = (page: Page) => page.getByRole("toolbar", { name: "Insert" });
const panel = (page: Page) => page.getByRole("dialog", { name: /Add image|Replace image/ });

const pexelsPhoto = (id: string, alt: string) => ({
  id,
  width: 3000,
  height: 2000,
  alt,
  photographer: "Ada Lovelace",
  photographerUrl: "https://www.pexels.com/@ada",
  pageUrl: `https://www.pexels.com/photo/${id}/`,
  src: {
    large: `https://images.pexels.com/photos/${id}/large.jpeg`,
    medium: `https://images.pexels.com/photos/${id}/medium.jpeg`,
    tiny: `https://images.pexels.com/photos/${id}/tiny.jpeg`,
  },
});

/**
 * The api's Pexels routes, mocked: search answers one page, pick copies into the bucket, and the
 * file proxy serves the picked bytes. CI never hits Pexels.
 */
async function mockSearch(page: Page) {
  const asked: string[] = [];
  await page.route(`${E2E_API_URL}/images/search*`, (route) => {
    asked.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        photos: [pexelsPhoto("river", "River bend"), pexelsPhoto("delta", "Delta")],
        nextPage: 2,
      }),
    });
  });
  await page.route(`${E2E_API_URL}/images/pick`, (route) => {
    const id = String((route.request().postDataJSON() as { id?: string })?.id ?? "river");
    const photo = pexelsPhoto(id, id === "river" ? "River bend" : "Delta");
    const key = `ws/images/${id}.jpg`;
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        key,
        url: `/files/${key}`,
        width: photo.width,
        height: photo.height,
        bytes: PNG.length,
        contentType: "image/png",
        source: {
          provider: "pexels",
          id: photo.id,
          pageUrl: photo.pageUrl,
          photographer: photo.photographer,
          photographerUrl: photo.photographerUrl,
        },
      }),
    });
  });
  await page.route(`${E2E_API_URL}/files/**`, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
  );
  // Thumbnails render in plain <img> tags: serve the fixture so tiles paint.
  await page.route("https://images.pexels.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
  );
  return asked;
}

async function openPhotos(page: Page, term: string) {
  await rail(page).getByRole("button", { name: "Image" }).click();
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole("tab", { name: "Photos" }).click();
  const field = panel(page).getByRole("searchbox", { name: "Search images" });
  await field.fill(term);
  await field.press("Enter");
}

/** The new image's `<img>`: a data URL whose decoded edge fits the downscale cap. */
async function expectInlined(img: ReturnType<Page["locator"]>) {
  await expect(img).toHaveAttribute("src", /^data:image\//);
  const natural = await img.evaluate((el) => {
    const i = el as HTMLImageElement;
    return { w: i.naturalWidth, h: i.naturalHeight };
  });
  expect(Math.max(natural.w, natural.h)).toBeLessThanOrEqual(MAX_EDGE);
  expect(Math.max(natural.w, natural.h)).toBeGreaterThan(0);
}

test.describe("editor images", () => {
  test("row 2: uploading a 3000x2000 PNG adds a centred, downscaled image as one undo step", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    await expect(elements(page).first()).toBeVisible();
    const count = await elements(page).count();
    const before = await elementIds(page);

    // `i` only opens the panel while the canvas has focus; click the gutter first.
    await page.getByRole("group", { name: "Slide canvas" }).click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("i");
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByRole("tab", { name: "Upload", selected: true })).toBeVisible();
    await expect(panel(page).getByRole("tab", { name: /GIF/i })).toHaveCount(0);
    await panel(page).locator('input[type="file"]').setInputFiles(FIXTURE);

    await expect(elements(page)).toHaveCount(count + 1);
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByRole("toolbar", { name: "Image" })).toBeVisible();
    const added = addedElement(page, before);
    await expectInlined(added.locator("img"));
    const box = await added.boundingBox();
    const slide = await page.locator("[data-slide-frame]").boundingBox();
    if (!box || !slide) throw new Error("no layout");
    expect(Math.abs(box.x + box.width / 2 - (slide.x + slide.width / 2))).toBeLessThan(2);
    // 3:2 aspect, capped at 60% of the slide width.
    expect(Math.abs(box.width / box.height - 1.5)).toBeLessThan(0.02);
    expect(box.width / slide.width).toBeLessThanOrEqual(0.61);

    await page.keyboard.press("Escape");
    await page.getByRole("group", { name: "Slide canvas" }).click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("ControlOrMeta+z");
    await expect(elements(page)).toHaveCount(count);
  });

  test("row 3: an image pasted onto the canvas is inserted at the centre", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    await expect(elements(page).first()).toBeVisible();
    const count = await elements(page).count();
    const before = await elementIds(page);
    await page.getByRole("group", { name: "Slide canvas" }).click({ position: { x: 5, y: 5 } });
    await page.evaluate((bytes) => {
      const file = new File([new Uint8Array(bytes)], "paste.png", { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);
      window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    }, Array.from(PNG));
    await expect(elements(page)).toHaveCount(count + 1);
    const added = addedElement(page, before);
    await expectInlined(added.locator("img"));
    const box = await added.boundingBox();
    const slide = await page.locator("[data-slide-frame]").boundingBox();
    if (!box || !slide) throw new Error("no layout");
    expect(Math.abs(box.x + box.width / 2 - (slide.x + slide.width / 2))).toBeLessThan(2);
  });

  test("row 4: a file dropped near the corner lands under the pointer, clamped to the slide", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    await expect(elements(page).first()).toBeVisible();
    const count = await elements(page).count();
    const before = await elementIds(page);
    const slide = await page.locator("[data-slide-frame]").boundingBox();
    if (!slide) throw new Error("no layout");
    // 10px inside the top-left corner: the centred frame would overhang and must be clamped.
    const at = { x: slide.x + 10, y: slide.y + 10 };
    await page.evaluate(
      ({ bytes, at }) => {
        const file = new File([new Uint8Array(bytes)], "drop.png", { type: "image/png" });
        const dt = new DataTransfer();
        dt.items.add(file);
        const target = document.elementFromPoint(at.x, at.y) ?? document.body;
        for (const type of ["dragover", "drop"] as const) {
          target.dispatchEvent(
            new DragEvent(type, {
              clientX: at.x,
              clientY: at.y,
              dataTransfer: dt,
              bubbles: true,
              cancelable: true,
            }),
          );
        }
      },
      { bytes: Array.from(PNG), at },
    );
    await expect(elements(page)).toHaveCount(count + 1);
    const added = addedElement(page, before);
    await expectInlined(added.locator("img"));
    const box = await added.boundingBox();
    if (!box) throw new Error("no layout");
    // Centred on the pointer would put the left edge far off the slide; the clamp keeps at least
    // OVERHANG (40pt) of it on, so the frame's right edge is well inside the slide.
    expect(box.x).toBeLessThan(at.x);
    expect(box.x + box.width).toBeGreaterThan(slide.x + 40 * (slide.width / 960) - 1);
    expect(box.x + box.width).toBeLessThan(slide.x + slide.width / 2);
  });

  test("rows 5–6: Photos searches Pexels and picking stores our URL with provenance", async ({
    signedInPage: { page, paths },
  }) => {
    const asked = await mockSearch(page);
    await page.goto(EDITOR(paths));
    await expect(elements(page).first()).toBeVisible();
    const count = await elements(page).count();
    const before = await elementIds(page);

    await openPhotos(page, "river");
    const tile = panel(page).getByRole("button", { name: "River bend" });
    await expect(tile).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "Delta" })).toBeVisible();
    expect(asked.length).toBeGreaterThan(0);
    const url = new URL(asked[0] ?? "");
    expect(url.origin + url.pathname).toBe(`${E2E_API_URL}/images/search`);
    expect(url.searchParams.get("q")).toBe("river");
    expect(url.searchParams.get("orientation")).toBe("landscape");

    // Row 6: picking copies the rendition into the bucket; the element carries our URL + source.
    await tile.click();
    await expect(elements(page)).toHaveCount(count + 1);
    await expect(panel(page)).toHaveCount(0);
    const picked = addedElement(page, before);
    await expect(picked.locator("img")).toHaveAttribute(
      "src",
      `${E2E_API_URL}/files/ws/images/river.jpg`,
    );
    await expect(picked.locator("img")).toHaveAttribute("alt", "River bend");
    await page
      .getByRole("toolbar", { name: "Image" })
      .getByRole("button", { name: "More" })
      .click();
    await expect(page.getByRole("dialog", { name: "More" })).toContainText(
      "Photo by Ada Lovelace on Pexels",
    );
    await page.keyboard.press("Escape");
  });

  test("row 8: a 500 from search shows the failure copy and Retry recovers", async ({
    signedInPage: { page, paths },
  }) => {
    let fail = true;
    await page.route(`${E2E_API_URL}/images/search*`, (route) =>
      fail
        ? route.fulfill({ status: 500, body: "boom" })
        : route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ photos: [pexelsPhoto("rain", "Rain")], nextPage: null }),
          }),
    );
    await page.goto(EDITOR(paths));
    await openPhotos(page, "rain");
    await expect(panel(page).getByText("Search failed. Try again.")).toBeVisible();
    fail = false;
    await panel(page).getByRole("button", { name: "Retry" }).click();
    await expect(panel(page).getByRole("button", { name: "Rain" })).toBeVisible();
  });

  test("row 9: Replace keeps the element and its frame and swaps src and alt", async ({
    signedInPage: { page, paths },
  }) => {
    await mockSearch(page);
    await page.goto(EDITOR(paths));
    await expect(elements(page).first()).toBeVisible();
    const count = await elements(page).count();
    const before = await elementIds(page);

    // Start from an uploaded image so the element exists.
    await rail(page).getByRole("button", { name: "Image" }).click();
    await panel(page).locator('input[type="file"]').setInputFiles(FIXTURE);
    await expect(elements(page)).toHaveCount(count + 1);
    const target = addedElement(page, before);
    const id = await target.getAttribute("data-element-id");
    const box = await target.boundingBox();
    const oldSrc = await target.locator("img").getAttribute("src");

    await page
      .getByRole("toolbar", { name: "Image" })
      .getByRole("button", { name: "Replace" })
      .click();
    await expect(page.getByRole("dialog", { name: "Replace image" })).toBeVisible();
    await panel(page).getByRole("tab", { name: "Photos" }).click();
    const field = panel(page).getByRole("searchbox", { name: "Search images" });
    await field.fill("river");
    await field.press("Enter");
    await panel(page).getByRole("button", { name: "River bend" }).click();

    await expect(elements(page)).toHaveCount(count + 1);
    const after = page.locator(`[data-slide-frame] [data-element-id="${id}"]`);
    await expect(after.locator("img")).toHaveAttribute("alt", "River bend");
    const newSrc = await after.locator("img").getAttribute("src");
    expect(newSrc).not.toBe(oldSrc);
    expect(newSrc).toBe(`${E2E_API_URL}/files/ws/images/river.jpg`);
    const frame = await after.boundingBox();
    if (!box || !frame) throw new Error("no layout");
    expect(Math.abs(frame.x - box.x)).toBeLessThan(1);
    expect(Math.abs(frame.width - box.width)).toBeLessThan(1);
    expect(Math.abs(frame.height - box.height)).toBeLessThan(1);
  });

  test("the panel's Photos tab with results (screenshot)", async ({
    signedInPage: { page, paths },
  }) => {
    test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
    await mockSearch(page);
    await page.goto(EDITOR(paths));
    await openPhotos(page, "river");
    await expect(panel(page).getByRole("button", { name: "River bend" })).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: "/tmp/teach-158-photos.png" });
  });
});
