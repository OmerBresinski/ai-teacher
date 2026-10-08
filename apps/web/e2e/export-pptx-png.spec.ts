/**
 * Export phase E2 (TEACH-111; ADR 0023 §3, §4): PowerPoint and PNG from the export dialog, both
 * loaded on click, with their credits. A seeded lesson carries a picture served by the api's file
 * proxy (TEACH-272 §1), and both exporters must fetch it with the session cookie. The proxy is
 * mocked with `page.route` (never the bucket), and the mock reads the request's `cookie` header to
 * prove the credentials went with it. The other rows were cut to keep e2e to the critical journeys
 * (8 Oct 2026).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Lesson } from "@tj/domain/documents";
import { demoWorkspace } from "@tj/editor/starter";
import JSZip from "jszip";
import { E2E_API_URL, E2E_WEB_URL, expect, seedCreditedLesson, test } from "./fixtures";

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
  test("row 5: downloads <slug>.pptx with one slide per build step, plus the /files/ picture with the cookie", {
    tag: "@smoke",
  }, async ({ signedInPage: { page } }) => {
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

test.describe("PNG export", () => {});

// TEACH-161 rows 5–7: the credited lesson ends every PowerPoint and PNG export on "Image credits".
test.describe("image credits", () => {
  /** Collect downloads as they land; resolves once `count` have arrived. */
  const collect = (page: import("@playwright/test").Page, count: number) => {
    const downloads: import("@playwright/test").Download[] = [];
    const done = new Promise<import("@playwright/test").Download[]>((resolve) => {
      page.on("download", (d) => {
        downloads.push(d);
        if (downloads.length === count) resolve(downloads);
      });
    });
    return done;
  };

  /**
   * Record every progress label and every credits picture the stage mounts. A small deck at 2x
   * captures faster than an assertion can poll, so the page keeps the log itself.
   */
  const watchRun = (page: import("@playwright/test").Page) =>
    page.evaluate(() => {
      const log = { labels: [] as string[], credits: [] as string[] };
      (window as unknown as { __run: typeof log }).__run = log;
      new MutationObserver(() => {
        const label = document.querySelector("[data-export-dialog] output")?.textContent ?? "";
        if (label && log.labels.at(-1) !== label) log.labels.push(label);
        const credits = document.querySelector("[data-capture-stage] [data-credits-slide]");
        if (credits && log.credits.at(-1) !== credits.textContent) {
          log.credits.push(credits.textContent ?? "");
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
  const runLog = (page: import("@playwright/test").Page) =>
    page.evaluate(
      () => (window as unknown as { __run: { labels: string[]; credits: string[] } }).__run,
    );

  test("PowerPoint: the last slide is the credits slide, with the photographer as a link", async ({
    signedInPage: { page },
  }) => {
    const id = await seedCreditedLesson(page);
    await page.goto(`/l/${id}`);
    const dialog = await openExport(page, "PowerPoint");
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Export PowerPoint" }).click();
    const zip = await JSZip.loadAsync(readFileSync(await (await download).path()));
    const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slides).toHaveLength(5);
    const last = (await zip.file("ppt/slides/slide5.xml")?.async("string")) ?? "";
    expect(last).toContain("Image credits");
    expect(last).toContain("<a:hlinkClick");
    const rels = (await zip.file("ppt/slides/_rels/slide5.xml.rels")?.async("string")) ?? "";
    expect(rels).toContain('Target="https://www.pexels.com/@ada"');
  });

  test("row 6: PNG of the whole deck downloads every slide, then <slug>-credits.png at 2x", {
    tag: "@smoke",
  }, async ({ signedInPage: { page } }) => {
    test.setTimeout(90_000);
    const id = await seedCreditedLesson(page);
    await page.goto(`/l/${id}`);
    const dialog = await openExport(page, "PNG");
    const files = collect(page, 5);
    await watchRun(page);
    await dialog.getByRole("button", { name: "Export PNG" }).click();
    const downloads = await files;
    expect((await runLog(page)).labels).toEqual([1, 2, 3, 4, 5].map((n) => `Exporting ${n} of 5`));
    expect(downloads.map((d) => d.suggestedFilename())).toEqual([
      "pictures-of-the-sky-1.png",
      "pictures-of-the-sky-2.png",
      "pictures-of-the-sky-3.png",
      "pictures-of-the-sky-4.png",
      "pictures-of-the-sky-credits.png",
    ]);
    const credits = readFileSync(
      await (downloads.at(-1) as import("@playwright/test").Download).path(),
    );
    expect(credits.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect(pngSize(credits)).toEqual({ width: 1920, height: 1080 });
    await expect(page.getByText("4 slides exported as PNG")).toBeVisible();
    await expect(page.locator("[data-capture-stage]")).toHaveCount(0);
  });
});
