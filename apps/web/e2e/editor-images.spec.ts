import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures";

/*
 * Images in the lesson editor (TEACH-107 rows 2–7, 9): upload, paste and drop land a downscaled
 * data-URL image element; the Photos tab searches Openverse (mocked with `page.route` — CI never
 * hits the network), inlines a result the host serves with CORS and falls back to a link with a
 * toast when it does not; Replace keeps the element and its frame.
 */

const EDITOR = "/l/demo-water-cycle";
const FIXTURE = fileURLToPath(new URL("./fixtures/photo-3000x2000.png", import.meta.url));
const PNG = readFileSync(FIXTURE);
/** A different picture for the search results, so a replaced `src` can be told from the upload. */
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#c84"/></svg>';
const OPENVERSE = "https://api.openverse.org/**";
/** `fileToDataUrl`'s default long edge. */
const MAX_EDGE = 1600;

const elements = (page: Page) => page.locator("[data-slide-frame] [data-element-id]");
const rail = (page: Page) => page.getByRole("toolbar", { name: "Insert" });
const panel = (page: Page) => page.getByRole("dialog", { name: /Add image|Replace image/ });

const row = (id: string, title: string, host: string) => ({
  id,
  title,
  url: `https://${host}/${id}.png`,
  thumbnail: `https://${host}/${id}-thumb.png`,
  creator: "Ada Lovelace",
  license: "by",
  license_version: "2.0",
  foreign_landing_url: `https://${host}/pages/${id}`,
  width: 3000,
  height: 2000,
});

/** Openverse answers one page; `cors.test` serves the PNG with CORS, `nocors.test` refuses. */
async function mockSearch(page: Page) {
  const asked: string[] = [];
  await page.route(OPENVERSE, (route) => {
    asked.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        page_count: 1,
        results: [row("river", "River bend", "cors.test"), row("delta", "Delta", "nocors.test")],
      }),
    });
  });
  const png = (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      headers: { "access-control-allow-origin": "*" },
      body: SVG,
    });
  await page.route("https://cors.test/**", png);
  // Thumbnails render in an <img>, which needs no CORS; the full-size fetch is the one that fails.
  await page.route("https://nocors.test/**", (route) =>
    route.request().url().includes("-thumb") ? png(route) : route.abort("failed"),
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
    signedInPage: { page },
  }) => {
    await page.goto(EDITOR);
    await expect(elements(page).first()).toBeVisible();
    const count = await elements(page).count();

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
    const added = elements(page).last();
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
    signedInPage: { page },
  }) => {
    await page.goto(EDITOR);
    await expect(elements(page).first()).toBeVisible();
    const count = await elements(page).count();
    await page.getByRole("group", { name: "Slide canvas" }).click({ position: { x: 5, y: 5 } });
    await page.evaluate((bytes) => {
      const file = new File([new Uint8Array(bytes)], "paste.png", { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);
      window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
    }, Array.from(PNG));
    await expect(elements(page)).toHaveCount(count + 1);
    const added = elements(page).last();
    await expectInlined(added.locator("img"));
    const box = await added.boundingBox();
    const slide = await page.locator("[data-slide-frame]").boundingBox();
    if (!box || !slide) throw new Error("no layout");
    expect(Math.abs(box.x + box.width / 2 - (slide.x + slide.width / 2))).toBeLessThan(2);
  });

  test("row 4: a file dropped near the corner lands under the pointer, clamped to the slide", async ({
    signedInPage: { page },
  }) => {
    await page.goto(EDITOR);
    await expect(elements(page).first()).toBeVisible();
    const count = await elements(page).count();
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
    const added = elements(page).last();
    await expectInlined(added.locator("img"));
    const box = await added.boundingBox();
    if (!box) throw new Error("no layout");
    // Centred on the pointer would put the left edge far off the slide; the clamp keeps at least
    // OVERHANG (40pt) of it on, so the frame's right edge is well inside the slide.
    expect(box.x).toBeLessThan(at.x);
    expect(box.x + box.width).toBeGreaterThan(slide.x + 40 * (slide.width / 960) - 1);
    expect(box.x + box.width).toBeLessThan(slide.x + slide.width / 2);
  });

  test("rows 5–7: Photos searches Openverse, inlines a CORS-served result and links one that is not", async ({
    signedInPage: { page },
  }) => {
    const asked = await mockSearch(page);
    await page.goto(EDITOR);
    await expect(elements(page).first()).toBeVisible();
    const count = await elements(page).count();

    await openPhotos(page, "river");
    const tile = panel(page).getByRole("button", { name: "River bend by Ada Lovelace, CC BY 2.0" });
    await expect(tile).toBeVisible();
    await expect(
      panel(page).getByRole("button", { name: "Delta by Ada Lovelace, CC BY 2.0" }),
    ).toBeVisible();
    expect(asked.length).toBeGreaterThan(0);
    const url = new URL(asked[0] ?? "");
    expect(url.origin + url.pathname).toBe("https://api.openverse.org/v1/images/");
    expect(url.searchParams.get("q")).toBe("river");
    expect(url.searchParams.get("license_type")).toBe("commercial,modification");

    // Row 6: the host serves the bytes with CORS → inlined, credit stored.
    await tile.click();
    await expect(elements(page)).toHaveCount(count + 1);
    await expect(panel(page)).toHaveCount(0);
    const inlined = elements(page).last();
    await expect(inlined.locator("img")).toHaveAttribute("src", /^data:image\/svg\+xml/);
    await expect(inlined.locator("img")).toHaveAttribute("alt", "River bend");
    await page
      .getByRole("toolbar", { name: "Image" })
      .getByRole("button", { name: "More" })
      .click();
    await expect(page.getByRole("dialog", { name: "More" })).toContainText(
      "River bend by Ada Lovelace, CC BY 2.0",
    );
    await page.keyboard.press("Escape");

    // Row 7: the host refuses CORS → the remote URL, and the toast says exports will not carry it.
    await openPhotos(page, "river");
    await panel(page).getByRole("button", { name: "Delta by Ada Lovelace, CC BY 2.0" }).click();
    await expect(elements(page)).toHaveCount(count + 2);
    await expect(elements(page).last().locator("img")).toHaveAttribute(
      "src",
      "https://nocors.test/delta.png",
    );
    await expect(page.getByText("Added as a link. It will not appear in exports.")).toBeVisible();
  });

  test("row 8: a 500 from Openverse shows the failure copy and Retry recovers", async ({
    signedInPage: { page },
  }) => {
    let fail = true;
    await page.route(OPENVERSE, (route) =>
      fail
        ? route.fulfill({ status: 500, body: "boom" })
        : route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ page_count: 1, results: [row("r", "Rain", "cors.test")] }),
          }),
    );
    await page.route("https://cors.test/**", (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
    );
    await page.goto(EDITOR);
    await openPhotos(page, "rain");
    await expect(panel(page).getByText("Search failed. Try again.")).toBeVisible();
    fail = false;
    await panel(page).getByRole("button", { name: "Retry" }).click();
    await expect(
      panel(page).getByRole("button", { name: "Rain by Ada Lovelace, CC BY 2.0" }),
    ).toBeVisible();
  });

  test("row 9: Replace keeps the element and its frame and swaps src and alt", async ({
    signedInPage: { page },
  }) => {
    await mockSearch(page);
    await page.goto(EDITOR);
    await expect(elements(page).first()).toBeVisible();
    const count = await elements(page).count();

    // Start from an uploaded image so the element exists.
    await rail(page).getByRole("button", { name: "Image" }).click();
    await panel(page).locator('input[type="file"]').setInputFiles(FIXTURE);
    await expect(elements(page)).toHaveCount(count + 1);
    const target = elements(page).last();
    const id = await target.getAttribute("data-element-id");
    const before = await target.boundingBox();
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
    await panel(page)
      .getByRole("button", { name: "River bend by Ada Lovelace, CC BY 2.0" })
      .click();

    await expect(elements(page)).toHaveCount(count + 1);
    const after = page.locator(`[data-slide-frame] [data-element-id="${id}"]`);
    await expect(after.locator("img")).toHaveAttribute("alt", "River bend");
    const newSrc = await after.locator("img").getAttribute("src");
    expect(newSrc).not.toBe(oldSrc);
    expect(newSrc?.startsWith("data:image/")).toBe(true);
    const frame = await after.boundingBox();
    if (!before || !frame) throw new Error("no layout");
    expect(Math.abs(frame.x - before.x)).toBeLessThan(1);
    expect(Math.abs(frame.width - before.width)).toBeLessThan(1);
    expect(Math.abs(frame.height - before.height)).toBeLessThan(1);
  });

  test("the panel's Photos tab with results (screenshot)", async ({ signedInPage: { page } }) => {
    test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
    await mockSearch(page);
    await page.goto(EDITOR);
    await openPhotos(page, "river");
    await expect(
      panel(page).getByRole("button", { name: "River bend by Ada Lovelace, CC BY 2.0" }),
    ).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: "/tmp/teach-107-photos.png" });
  });
});
