/** TEACH-184 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-184-screenshots.spec.ts`. */
import { expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 } });

test("captures Source, Kind, Kind filtered by Practise, and the created sheet", async ({
  signedInPage: { page },
}) => {
  await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
  await page.goto("/worksheets/new");
  await expect(page.getByRole("list", { name: "Recent lessons" })).toBeVisible();
  await page.getByRole("button", { name: /^The water cycle\./ }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-184-source.png" });

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".ws-mini .ws-page")).toHaveCount(9);
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/teach-184-kind.png", fullPage: true });

  await page.getByRole("button", { name: "Practise", exact: true }).click();
  await expect(page.locator(".ws-mini .ws-page")).toHaveCount(3);
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-184-kind-practise.png" });

  await page.getByRole("button", { name: "Practise", exact: true }).click();
  await page.getByRole("button", { name: /^Exit ticket\./ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/w\/[^/]+$/);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.locator(".ws-column .ws-block")).toHaveCount(5);
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/teach-184-created-sheet.png" });
});
