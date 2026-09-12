/**
 * Export phase E2 (TEACH-111; ADR 0023 §3, §4): PowerPoint and PNG from the export dialog, both
 * loaded on click. Rows 5–7 of the ticket plus the `/files/` image row from TEACH-272 §1: a seeded
 * lesson carries a picture served by the api's file proxy, and both exporters must fetch it with
 * the session cookie. The proxy is mocked with `page.route` (never the bucket), and the mock reads
 * the request's `cookie` header to prove the credentials went with it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Lesson } from "@tj/domain/documents";
import { demoWorkspace } from "@tj/editor/starter";
import JSZip from "jszip";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

const PNG = readFileSync(fileURLToPath(new URL("./fixtures/photo-3000x2000.png", import.meta.url)));
const FILE_URL = `${E2E_API_URL}/files/ws/images/river.jpg`;

/** Width and height from a PNG's IHDR chunk (bytes 16–23, big-endian). */
const pngSize = (bytes: Buffer) => ({
  width: bytes.readUInt32BE(16),
  height: bytes.readUInt32BE(20),
});

const water = () => {
  const item = demoWorkspace(new Date()).find((d) => d.key === "demo-water-cycle");
  if (!item || !("slides" in item.body)) throw new Error("fixture missing");
  return item;
};

/** The water-cycle lesson with a `/files/` picture on slide 1, seeded fresh for one test. */
async function seedPictureLesson(page: import("@playwright/test").Page): Promise<string> {
  const item = water();
  const body = item.body as Lesson;
  const [first, ...rest] = body.slides;
  if (!first) throw new Error("fixture");
  const withPicture: Lesson = {
    ...body,
    updatedAt: new Date().toISOString(),
    slides: [
      {
        ...first,
        elements: [
          ...first.elements,
          {
            id: "pic1",
            type: "image",
            x: 560,
            y: 120,
            w: 320,
            h: 213,
            src: FILE_URL,
            fit: "cover",
            alt: "A river",
          },
        ],
      },
      ...rest,
    ],
  };
  const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
    headers: { origin: E2E_WEB_URL },
    data: { documents: [{ ...item, key: "picture", body: withPicture }] },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const { ids } = (await res.json()) as { ids: Record<string, string> };
  const id = ids.picture;
  if (!id) throw new Error("seed returned no id");
  return id;
}

/** Serve the mocked picture and record whether each request carried the session cookie. */
async function mockFileProxy(page: import("@playwright/test").Page) {
  const cookies: boolean[] = [];
  await page.route(`${E2E_API_URL}/files/**`, async (route) => {
    // `headers()` leaves out cookie headers; `allHeaders()` reports the request as sent.
    cookies.push(Boolean((await route.request().allHeaders()).cookie));
    return route.fulfill({
      status: 200,
      contentType: "image/png",
      body: PNG,
      headers: {
        "access-control-allow-origin": E2E_WEB_URL,
        "access-control-allow-credentials": "true",
        "cross-origin-resource-policy": "cross-origin",
      },
    });
  });
  return cookies;
}

const openExport = async (page: import("@playwright/test").Page, tab: string) => {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: tab }).click();
  return dialog;
};

test.describe("PowerPoint export", () => {
  test("row 5: downloads <slug>.pptx with one slide per build step, plus the /files/ picture with the cookie", async ({
    signedInPage: { page },
  }) => {
    const id = await seedPictureLesson(page);
    const cookies = await mockFileProxy(page);
    await page.goto(`/l/${id}`);
    const dialog = await openExport(page, "PowerPoint");
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Export PowerPoint" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("the-water-cycle.pptx");
    const bytes = readFileSync(await file.path());
    expect(bytes.byteLength).toBeGreaterThan(10_000);
    const zip = await JSZip.loadAsync(bytes);
    const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    // The demo deck has no reveal steps and answers are off: one PPTX slide per slide, no key.
    expect(slides).toHaveLength((water().body as Lesson).slides.length);
    // The picture was embedded, not left as a labelled plate, and its fetch carried the cookie.
    expect(Object.keys(zip.files).some((n) => /^ppt\/media\/image[\w-]*\.png$/.test(n))).toBe(true);
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string");
    expect(slide1).not.toContain("Image could not be embedded");
    expect(cookies.length).toBeGreaterThan(0);
    expect(cookies.every(Boolean)).toBe(true);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Lesson exported as PowerPoint")).toBeVisible();
  });
});

test.describe("PNG export", () => {
  test("row 6: scale 2, range 1-2 → two files at 1920x1080, the /files/ picture fetched with the cookie", async ({
    signedInPage: { page },
  }) => {
    test.setTimeout(60_000);
    const id = await seedPictureLesson(page);
    const cookies = await mockFileProxy(page);
    await page.goto(`/l/${id}`);
    const dialog = await openExport(page, "PNG");
    await expect(dialog.getByRole("radio", { name: "2x" })).toHaveAttribute("aria-checked", "true");
    await dialog.getByRole("textbox", { name: "Slides" }).fill("1-2");
    // Both listeners are on before the click: the second file can land while the first is read.
    const downloads: import("@playwright/test").Download[] = [];
    const twoFiles = new Promise<void>((resolve) => {
      page.on("download", (d) => {
        downloads.push(d);
        if (downloads.length === 2) resolve();
      });
    });
    await dialog.getByRole("button", { name: "Export PNG" }).click();
    await twoFiles;
    expect(downloads.map((d) => d.suggestedFilename())).toEqual([
      "the-water-cycle-1.png",
      "the-water-cycle-2.png",
    ]);
    for (const d of downloads) {
      const bytes = readFileSync(await d.path());
      expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
      expect(pngSize(bytes)).toEqual({ width: 1920, height: 1080 });
    }
    // Slide 1 holds the picture: its bytes were fetched through the credentialed path.
    expect(cookies.length).toBeGreaterThan(0);
    expect(cookies.every(Boolean)).toBe(true);
    await expect(page.getByText("2 slides exported as PNG")).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("[data-capture-stage]")).toHaveCount(0);
  });

  test("row 7: closing the dialog mid-run stops after the file in hand and unmounts the stage", async ({
    signedInPage: { page, paths },
  }) => {
    test.setTimeout(60_000);
    await page.goto(paths.lesson("demo-water-cycle"));
    const dialog = await openExport(page, "PNG");
    // 3x makes each capture slow enough to catch the run between files.
    await dialog.getByRole("radio", { name: "3x" }).click();
    const first = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Export PNG" }).click();
    await expect(dialog.getByText(/Exporting 1 of \d+/)).toBeVisible();
    await expect(page.locator("[data-capture-stage]")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect((await first).suggestedFilename()).toBe("the-water-cycle-1.png");
    await expect(page.getByText("Export stopped")).toBeVisible();
    await expect(page.locator("[data-capture-stage]")).toHaveCount(0);
    // No second file arrives: the wait times out.
    const more = await page
      .waitForEvent("download", { timeout: 1_500 })
      .then(() => true)
      .catch(() => false);
    expect(more).toBe(false);
  });
});
