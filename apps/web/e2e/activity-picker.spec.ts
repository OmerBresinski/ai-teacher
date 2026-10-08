import type { Page } from "@playwright/test";
import { expect, type SeededPaths, test } from "./fixtures";

/* TEACH-185: one activity picker with live previews; staged reveal in present. */

const EDITOR = (paths: SeededPaths) => paths.lesson("demo-water-cycle");
const status = (page: Page) => page.getByRole("status").first();

async function openActivities(page: Page) {
  await page
    .getByRole("toolbar", { name: "Insert" })
    .getByRole("button", { name: "Activities" })
    .click();
  const menu = page.getByRole("menu", { name: "Activities" });
  await expect(menu).toBeVisible();
  return menu;
}

/** The answer cards on the present stage that are dimmed (a wrong option once revealed). */
async function dimmedCards(page: Page): Promise<number> {
  return page
    .locator("[data-slide-mode='present'] [data-element-type='option'] > div > div")
    .evaluateAll(
      (nodes) => nodes.filter((n) => (n as HTMLElement).style.opacity === "0.45").length,
    );
}

test.describe("activity picker", () => {
  test("row 6: present, four-option multiple choice, Right x3 dims the wrong options, then the right one fills", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    await expect(page.locator("[data-slide-frame]")).toBeVisible();
    const menu = await openActivities(page);
    await menu.getByRole("menuitem", { name: "Multiple choice", exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 5_000 });

    await page.goto(`${paths.lesson("demo-water-cycle", "/present")}?slide=2`);
    await expect(page.locator('[data-slide-mode="present"]')).toHaveCount(1);
    await expect(status(page)).toContainText("Slide 2 of");
    await expect(status(page)).toContainText("step 1 of 5");
    const filled = page.getByRole("img", { name: "Correct answer" });
    expect(await dimmedCards(page)).toBe(0);
    await page.keyboard.press("ArrowRight");
    await expect(status(page)).toContainText("step 2 of 5");
    expect(await dimmedCards(page)).toBe(1);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(status(page)).toContainText("step 4 of 5");
    expect(await dimmedCards(page)).toBe(3);
    await expect(filled).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Answer/ })).toBeVisible();
    await page.keyboard.press("Space");
    await expect(status(page)).toContainText("answer shown");
    await expect(filled).toHaveCount(1);
    expect(await dimmedCards(page)).toBe(3);
  });
});
