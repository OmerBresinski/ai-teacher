/**
 * Export phase E1 (TEACH-110; ADR 0023): the export dialog, the lesson print route
 * (`/l/:id/print`), the JSON download and the library Import. Rows 3, 4, 5, 6 and 8 of the ticket.
 * `window.print` and `window.open` are stubbed in `addInitScript` so nothing leaves the page.
 */
import { generatedLesson } from "@tj/domain/documents/fixtures";
import { demoWorkspace } from "@tj/editor/starter";
import { expect, test } from "./fixtures";

declare global {
  interface Window {
    __prints?: number;
    __opened?: string[];
  }
}

/** Count the `/Type /Page` objects in a PDF (Chromium writes one per printed page). */
const pdfPageCount = (pdf: Buffer) =>
  (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

const water = () => {
  const item = demoWorkspace(new Date()).find((d) => d.key === "demo-water-cycle");
  if (!item || !("slides" in item.body)) throw new Error("fixture missing");
  return item.body;
};

test.describe("lesson print route", () => {
  test("row 3: ?auto=1&notes=1 renders one A4 page per slide with notes and prints once", async ({
    signedInPage: { page, paths },
  }) => {
    await page.addInitScript(() => {
      window.__prints = 0;
      window.print = () => {
        window.__prints = (window.__prints ?? 0) + 1;
      };
    });
    const count = water().slides.length;
    await page.goto(`${paths.lesson("demo-water-cycle", "/print")}?auto=1&notes=1`);
    await expect(page).toHaveTitle("The water cycle · Teaching Journey");
    const pages = page.locator(".td-print .td-handout-page");
    await expect(pages).toHaveCount(count);
    await expect(pages.first().getByText(`The water cycle · Slide 1 of ${count}`)).toBeVisible();
    await expect(pages.first().locator(".td-handout-notes")).toBeVisible();
    // No app chrome on the print route.
    await expect(page.getByRole("button", { name: "Back to the library" })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__prints)).toBe(1);
    await expect(page.locator("html")).toHaveAttribute("data-capture-ready", "true");
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__prints)).toBe(1);
  });

  test("row 4: ?handout=3 puts three slides on a page; ?slides=2-3 prints only those", async ({
    signedInPage: { page, paths },
  }) => {
    const count = water().slides.length;
    await page.goto(`${paths.lesson("demo-water-cycle", "/print")}?handout=3`);
    const h3pages = page.locator(".td-print .td-handout3-page");
    await expect(h3pages).toHaveCount(Math.ceil(count / 3));
    await expect(h3pages.first().locator(".td-handout3-row")).toHaveCount(3);
    await expect(h3pages.first().locator(".td-handout3-lines").first()).toBeVisible();

    await page.goto(`${paths.lesson("demo-water-cycle", "/print")}?slides=2-3`);
    const pages = page.locator(".td-print .td-print-page");
    await expect(pages).toHaveCount(2);
    await expect(pages.nth(0)).toHaveAttribute("data-slide-index", "2");
    await expect(pages.nth(1)).toHaveAttribute("data-slide-index", "3");
  });

  test("row 5: a range past the end falls back to every slide; print media yields N pages", async ({
    signedInPage: { page, paths },
  }) => {
    const count = water().slides.length;
    await page.goto(`${paths.lesson("demo-water-cycle", "/print")}?slides=99`);
    const pages = page.locator(".td-print .td-print-page");
    await expect(pages).toHaveCount(count);
    await expect(page.locator("html")).toHaveAttribute("data-capture-ready", "true");

    await page.emulateMedia({ media: "print" });
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(pages.first()).toHaveCSS("box-shadow", "none");
    const pdf = await page.pdf({ preferCSSPageSize: true });
    expect(pdfPageCount(pdf)).toBe(count);
  });
});

test.describe("export dialog", () => {
  test.beforeEach(async ({ signedInPage: { page } }) => {
    await page.addInitScript(() => {
      window.__opened = [];
      window.open = ((url: string | URL) => {
        window.__opened?.push(String(url));
        return null;
      }) as typeof window.open;
    });
  });

  test("row 2: PDF with a range and answers opens the print route with those params", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(paths.lesson("demo-water-cycle"));
    await page.getByRole("button", { name: "Export" }).click();
    const dialog = page.getByRole("dialog", { name: "Export" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("tab", { name: "PowerPoint" })).toBeDisabled();
    await expect(dialog.getByRole("tab", { name: "PNG" })).toBeDisabled();
    await dialog.getByRole("textbox", { name: "Slides" }).fill("1-3, 5");
    await dialog.getByRole("switch", { name: "Include answers" }).click();
    await dialog.getByRole("button", { name: "Export PDF" }).click();
    await expect(dialog).toHaveCount(0);
    const opened = await page.evaluate(() => window.__opened);
    expect(opened).toEqual([
      `${paths.lesson("demo-water-cycle", "/print")}?auto=1&answers=1&slides=1-3%2C+5`,
    ]);
  });

  test("row 6: JSON downloads <slug>.teachdeck.json that parses back to the lesson", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(paths.lesson("demo-water-cycle", "/view"));
    await page.getByRole("button", { name: "Export" }).click();
    const dialog = page.getByRole("dialog", { name: "Export" });
    await dialog.getByRole("tab", { name: "JSON" }).click();
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Export JSON" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("the-water-cycle.teachdeck.json");
    const path = await file.path();
    const text = await (await import("node:fs/promises")).readFile(path, "utf8");
    const parsed = JSON.parse(text) as { id: string; title: string; slides: unknown[] };
    expect(parsed.title).toBe("The water cycle");
    expect(parsed.id).toBe(paths.id("demo-water-cycle"));
    expect(parsed.slides).toHaveLength(water().slides.length);
  });

  test("row 7: the worksheet editor exports JSON and its PDF tab opens the print route", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(paths.worksheet("fraction-practice"));
    await page.getByRole("button", { name: "Export" }).click();
    const dialog = page.getByRole("dialog", { name: "Export" });
    await expect(dialog.getByRole("tab", { name: "Word" })).toBeDisabled();
    await dialog.getByRole("tab", { name: "JSON" }).click();
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Export JSON" }).click();
    expect((await download).suggestedFilename()).toBe("fractions-practice.worksheet.json");

    // The dialog remembers its tab between opens; PDF is chosen again explicitly.
    await page.getByRole("button", { name: "Export" }).click();
    const reopened = page.getByRole("dialog", { name: "Export" });
    await reopened.getByRole("tab", { name: "PDF" }).click();
    await reopened.getByRole("button", { name: "Export PDF" }).click();
    expect(await page.evaluate(() => window.__opened)).toEqual([
      `${paths.worksheet("fraction-practice", "/print")}?auto=1`,
    ]);
  });
});

test.describe("library Import", () => {
  test("row 8: a lesson and a worksheet file become two new documents with server ids", async ({
    signedInPage: { page, paths },
  }) => {
    const lesson = generatedLesson();
    const sheet = demoWorkspace(new Date()).find((d) => d.key === "fraction-practice");
    if (!sheet) throw new Error("fixture missing");
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && /\/documents$/.test(new URL(request.url()).pathname)) {
        posts.push(request.url());
      }
    });

    await page.goto("/lessons");
    await page.getByRole("button", { name: "Import" }).click();
    const dialog = page.getByRole("dialog", { name: "Import" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Import files").setInputFiles([
      {
        name: "a.teachdeck.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({ ...lesson, title: "Imported lesson" })),
      },
      {
        name: "b.worksheet.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({ ...sheet.body, title: "Imported sheet" })),
      },
    ]);
    await expect(page.getByText("Imported 2 documents")).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(posts).toHaveLength(2);
    // The lesson list refreshed with the new document, under a new id (never the file's).
    const card = page.locator("article").filter({ hasText: "Imported lesson" });
    await expect(card).toHaveCount(1);
    await card.click();
    await expect(page).toHaveURL(/\/l\/[0-9a-f-]{36}$/);
    expect(page.url()).not.toContain(lesson.id);
    expect(page.url()).not.toContain(paths.id("demo-water-cycle"));
  });

  test("row 9: a newer-version file is refused with TeachDeck's copy", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons");
    await page.getByRole("button", { name: "Import" }).click();
    const dialog = page.getByRole("dialog", { name: "Import" });
    await dialog.getByLabel("Import files").setInputFiles({
      name: "future.teachdeck.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ ...generatedLesson(), version: 2 })),
    });
    await expect(
      page.getByText("This file was made with a newer version of TeachDeck (document version 2).", {
        exact: false,
      }),
    ).toBeVisible();
    // Still open: nothing was imported.
    await expect(dialog).toBeVisible();
  });
});
