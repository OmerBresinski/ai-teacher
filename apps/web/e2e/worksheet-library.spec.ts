/**
 * The Worksheets library (TEACH-186): marks and minutes on every card, New worksheet in the page
 * header, the whole card face opening the sheet, and the four seeded sheets printing as real
 * content, one or two pages on A4 and on Letter, with the answer key derived from the answers.
 */
import type { Page } from "@playwright/test";
import { demoWorkspace } from "@tj/editor/starter";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

/** Key, title, a phrase only that sheet's paper carries, and the card's minutes (UX ruling 60). */
const SHEETS = [
  ["fraction-practice", "Fractions practice", "Worked example", "20 min"],
  ["roman-source", "Roman source investigation", "Watling Street", "10 min"],
  ["plant-labels", "Label a flowering plant", "Figure 1: a flowering plant", "5 min"],
  ["river-vocabulary", "River vocabulary", "tributary", "5 min"],
] as const;

/** Content pages only: the answer key starts a fresh page and is not counted against the sheet. */
const contentPages = (page: Page) =>
  page.locator(".ws-print-root .ws-page:not(:has(.ws-key-title)):not(:has(.ws-key-entry))");

/** One or two content pages, no page ending on a heading, nothing reported as not fitting. */
async function expectCleanPages(page: Page): Promise<void> {
  await expect(page.locator(".ws-print-root")).toHaveCSS("visibility", "visible");
  const pages = contentPages(page);
  const count = await pages.count();
  expect(count).toBeGreaterThanOrEqual(1);
  expect(count).toBeLessThanOrEqual(2);
  for (let i = 0; i < count; i += 1) {
    const last = pages.nth(i).locator(".ws-block").last();
    await expect(last.locator(".ws-h1, .ws-h2")).toHaveCount(0);
  }
  await expect(page.locator(".ws-print-hint")).toHaveCount(0);
}

test.describe("worksheet library", () => {
  test("row 1: each seeded sheet prints real content matching its title on one or two A4 pages", async ({
    signedInPage: { page, paths },
  }) => {
    for (const [key, title, phrase] of SHEETS) {
      await page.goto(paths.worksheet(key, "/print"));
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await expect(page.locator(".ws-print-root").getByText(phrase).first()).toBeVisible();
      await expectCleanPages(page);
      // A4 at 1:1 is 595pt = 793.33px wide.
      const box = await contentPages(page).first().boundingBox();
      expect(box && Math.abs(box.width - 793.33) < 1).toBe(true);
    }
    // The plant sheet carries its drawing inline, with alt text.
    await page.goto(paths.worksheet("plant-labels", "/print"));
    await expect(page.locator(".ws-print-root img[alt*='flowering plant']")).toBeVisible();
  });

  test("row 1: the same sheets on Letter, with the answer key derived from the answers", async ({
    signedInPage: { page },
  }) => {
    const sheets = demoWorkspace(new Date())
      .filter((document) => document.kind === "worksheet")
      .map((document) => ({
        ...document,
        key: `${document.key}-letter`,
        body: {
          ...document.body,
          id: `${document.key}-letter`,
          pageSize: "Letter",
          includeAnswerKey: true,
        },
      }));
    const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
      headers: { origin: E2E_WEB_URL },
      data: { documents: sheets },
    });
    expect(res.ok(), `seed failed: ${res.status()} ${await res.text()}`).toBe(true);
    const { ids } = (await res.json()) as { ids: Record<string, string> };
    for (const sheet of sheets) {
      await page.goto(`/w/${ids[sheet.key]}/print`);
      await expect(page.getByRole("heading", { level: 1, name: sheet.body.title })).toBeVisible();
      await expectCleanPages(page);
      await expect(page.getByRole("heading", { level: 2, name: "Answer key" })).toBeVisible();
      await expect(page.locator(".ws-key-entry").first()).toBeVisible();
      // Letter at 1:1 is 612pt = 816px wide.
      const box = await contentPages(page).first().boundingBox();
      expect(box && Math.abs(box.width - 816) < 1).toBe(true);
    }
  });

  test("row 2: cards carry the minutes; New worksheet sits in the header and opens the flow", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/worksheets");
    await expect(page.getByRole("heading", { level: 1, name: "Worksheets" })).toBeVisible();
    for (const [, title, , effort] of SHEETS) {
      const card = page.locator("article", {
        has: page.getByRole("link", { name: `Open ${title}` }),
      });
      await expect(card).toContainText(effort);
    }
    const create = page.getByRole("button", { name: "New worksheet" });
    await expect(create).toBeVisible();
    await create.click();
    await expect(page).toHaveURL(/\/worksheets\/new$/);
    await expect(page.getByRole("heading", { level: 1, name: "New worksheet" })).toBeVisible();
  });

  test("row 3: the card face opens the sheet; Print and the overflow menu do not", async ({
    signedInPage: { page, paths },
    context,
  }) => {
    await page.goto("/worksheets");
    const card = page.locator("article", {
      has: page.getByRole("link", { name: "Open Fractions practice" }),
    });
    const thumb = card.locator("[data-slot='card-thumbnail']");
    const box = await thumb.boundingBox();
    if (!box) throw new Error("no thumbnail");
    // The upper part of the picture, clear of the hover strip that holds Print and the menu.
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await expect(page).toHaveURL(new RegExp(`${paths.worksheet("fraction-practice")}$`));
    await expect(page.getByRole("textbox", { name: "Sheet title" })).toHaveText(
      "Fractions practice",
    );

    await page.goto("/worksheets");
    await card.hover();
    await card.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Open" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/worksheets$/);

    await card.hover();
    // Print opens the print route with `?auto=1` in a new tab (TEACH-193 item 3); the library stays.
    const [printed] = await Promise.all([
      context.waitForEvent("page"),
      card.getByRole("button", { name: "Print" }).click(),
    ]);
    await expect(printed).toHaveURL(
      new RegExp(`${paths.worksheet("fraction-practice", "/print")}\\?auto=(%22)?1(%22)?$`),
    );
    await expect(page).toHaveURL(/\/worksheets$/);
    await printed.close();
  });

  test("row 4: Fractions practice belongs to Fractions of amounts", async ({
    signedInPage: { page, paths },
  }) => {
    const res = await page.request.get(
      `${E2E_API_URL}/documents/${paths.id("fraction-practice")}`,
      { headers: { origin: E2E_WEB_URL } },
    );
    expect(res.ok(), `GET /documents/:id failed: ${res.status()}`).toBe(true);
    const { document } = (await res.json()) as { document: { body: { lessonId?: string } } };
    expect(document.body.lessonId).toBe(paths.id("demo-fractions"));
  });
});
