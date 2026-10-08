import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { E2E_API_URL, E2E_WEB_URL } from "../playwright.config";
import { addedElement, elementIds, expect, type SeededPaths, test } from "./fixtures";

/*
 * Images in the lesson editor (TEACH-107 row 2, TEACH-158 rows 5–6): an upload lands a downscaled
 * data-URL image element, and the Photos tab searches Pexels through the api (mocked with
 * `page.route` — CI never hits the network); picking copies the rendition into the bucket and
 * stores our `/files` URL with provenance. The other rows were cut to keep e2e to the critical
 * journeys (8 Oct 2026).
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

    // TEACH-275 row 8: the rendered `src` is absolute (resolved against the api origin), but what
    // the document saves is the relative path — the origin is never written.
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    const saved = await page.request.get(
      `${E2E_API_URL}/documents/${paths.id("demo-water-cycle")}`,
      {
        headers: { origin: E2E_WEB_URL },
      },
    );
    expect(saved.ok(), await saved.text()).toBe(true);
    const body = JSON.stringify(await saved.json());
    expect(body).toContain('"src":"/files/ws/images/river.jpg"');
    expect(body).not.toContain(`${E2E_API_URL}/files/`);
  });
});
