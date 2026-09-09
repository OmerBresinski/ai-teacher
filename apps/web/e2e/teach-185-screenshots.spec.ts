/**
 * TEACH-185 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-185-screenshots.spec.ts`.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 } });

const shot = (name: string) => `/tmp/teach-185-${name}.png`;

async function openActivities(page: Page) {
  await page
    .getByRole("toolbar", { name: "Insert" })
    .getByRole("button", { name: "Activities" })
    .click();
  const menu = page.getByRole("menu", { name: "Activities" });
  await expect(menu).toBeVisible();
  return menu;
}

test("captures the picker on Activities, a matching slide and present mid-reveal", async ({
  signedInPage: { page, paths },
}) => {
  await page.goto(paths.lesson("demo-water-cycle"));
  await expect(page.locator("[data-slide-frame]")).toBeVisible();
  await page.waitForTimeout(400);

  let menu = await openActivities(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot("picker-activities") });

  await menu.getByRole("menuitem", { name: "Matching" }).click();
  await expect(menu).toBeHidden();
  await expect(page.locator("[data-slide-frame]")).toContainText("Match each term");
  await page.mouse.move(1300, 900);
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot("matching-slide") });

  menu = await openActivities(page);
  await menu.getByRole("menuitem", { name: "Multiple choice" }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 5_000 });

  await page.goto(`${paths.lesson("demo-water-cycle", "/present")}?slide=3`);
  await page.getByRole("button", { name: "Stay in this window" }).click();
  await expect(page.getByRole("status").first()).toContainText("Slide 3 of");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("status").first()).toContainText("step 3 of 5");
  await page.mouse.move(720, 60);
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot("present-mid-reveal") });
});
