import { expectNoSeriousA11yViolations } from "./a11y";

import { expect, type SeededPaths, test } from "./fixtures";

/** The rows' lesson ids, as demo keys (`roman-roads`, …) so the expectations read. */
const rowIds = async (page: import("@playwright/test").Page, paths: SeededPaths) =>
  (
    await page
      .getByRole("list", { name: "Lessons in teaching order" })
      .locator("li")
      .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-lesson-id")))
  ).map(paths.key);

test.describe("series detail", () => {
  test("opens from the Series page with header, counts, ordered rows and actions", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto("/series");
    await page.getByRole("link", { name: "Open The Romans" }).click();
    await expect(page).toHaveURL(new RegExp(`${paths.series("series-romans")}$`));
    await expect(page).toHaveTitle("The Romans · Teaching Journey");
    await expect(page.getByRole("heading", { name: "The Romans" })).toBeVisible();
    await expect(page.getByText(/3 lessons · \d+ slides/)).toBeVisible();
    // Series rows and the sheet stack render real slides (TEACH-99).
    expect(await page.locator("[data-slide-root]").count()).toBeGreaterThanOrEqual(3);
    expect(await rowIds(page, paths)).toEqual(["roman-roads", "demo-fractions", "roman-army"]);
    await expect(page.getByRole("button", { name: "Present series" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add lesson" })).toBeVisible();
  });

  test("reorders with the keyboard and keeps focus on the moved row", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(paths.series("series-romans"));
    const rows = page.getByRole("list", { name: "Lessons in teaching order" }).locator("li");
    await rows.first().focus();
    await page.keyboard.press("ControlOrMeta+ArrowDown");
    await expect
      .poll(() => rowIds(page, paths))
      .toEqual(["demo-fractions", "roman-roads", "roman-army"]);
    await expect(rows.nth(1)).toBeFocused();
    await expect(page.getByRole("status")).toHaveText("Moved to position 2");
    // Persisted through `PUT /documents/:id`: a full reload lists the lessons in the new order.
    await page.goto("/series");
    const band = page.locator("article", { hasText: "The Romans" });
    await expect(band.getByRole("list").locator("li").first()).toContainText(
      "Fractions of amounts",
    );
  });

  test("drags a row above the first with a real pointer", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(paths.series("series-romans"));
    const rows = page.getByRole("list", { name: "Lessons in teaching order" }).locator("li");
    await rows.nth(2).hover();
    const grip = rows.nth(2).getByRole("button", { name: "Reorder" });
    const gripBox = await grip.boundingBox();
    const firstBox = await rows.first().boundingBox();
    if (!gripBox || !firstBox) throw new Error("Rows have no layout");
    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(gripBox.x + gripBox.width / 2, firstBox.y + 4, { steps: 12 });
    await page.mouse.up();
    await expect
      .poll(() => rowIds(page, paths))
      .toEqual(["roman-army", "roman-roads", "demo-fractions"]);
  });

  test("removes a lesson and Undo restores it at the same index", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(paths.series("series-romans"));
    const rows = page.getByRole("list", { name: "Lessons in teaching order" }).locator("li");
    await rows.nth(1).hover();
    await rows.nth(1).getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Remove from series" }).click();
    await expect.poll(() => rowIds(page, paths)).toEqual(["roman-roads", "roman-army"]);
    await expect(page.getByText("Removed “Fractions of amounts”")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect
      .poll(() => rowIds(page, paths))
      .toEqual(["roman-roads", "demo-fractions", "roman-army"]);
  });

  test("adds lessons in candidate order and shows the missing-series state", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(paths.series("series-romans"));
    await page.getByRole("button", { name: "Add lesson" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("checkbox").nth(1).check();
    await dialog.getByRole("checkbox").nth(0).check();
    await dialog.getByRole("button", { name: "Add 2 lessons" }).click();
    // The rows appear optimistically while the dialog is still up; roles behind it are hidden, so
    // wait for it to close before reading them.
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(/5 lessons/)).toBeVisible();
    await expect.poll(() => rowIds(page, paths)).toHaveLength(5);

    // Fresh load: the return target is whatever shell page was last committed in this session.
    await page.goto("/series/00000000-0000-4000-8000-000000000000");
    await expect(page.getByText("This series was deleted or never existed.")).toBeVisible();
    await page.getByRole("button", { name: "Back to the library" }).click();
    await expect(page).toHaveURL(new RegExp(`${paths.series("series-romans")}$`));
  });

  test("has no serious or critical axe findings in both themes", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(paths.series("series-romans"));
    await expect(page.getByRole("heading", { name: "The Romans" })).toBeVisible();
    await expectNoSeriousA11yViolations(page, "/series/:id");
    await page.getByRole("button", { name: "Theme" }).click();
    await page.getByRole("menuitemradio", { name: "Dark" }).click();
    await page.waitForTimeout(400);
    await expectNoSeriousA11yViolations(page, "/series/:id (dark)");
  });
});
