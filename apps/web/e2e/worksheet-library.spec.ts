/**
 * The Worksheets library (TEACH-186): the whole card face opens the sheet, and Print and the
 * overflow menu do not. The cards' minutes and New worksheet are unit tests (TEACH-301).
 */
import { expect, test } from "./fixtures";

test.describe("worksheet library", () => {
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
});
