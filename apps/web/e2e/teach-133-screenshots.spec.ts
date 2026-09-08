/** TEACH-133 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-133-screenshots.spec.ts`. */
import { expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 }, seed: false });

test("captures the generating view mid-run and the finished editor with its residuals", async ({
  signedInPage: { page },
}) => {
  await page.goto("/lessons/new");
  await page.getByRole("textbox", { name: "Topic or objective" }).fill("States of matter");
  await page.getByRole("combobox", { name: "Year group" }).click();
  await page.getByRole("option", { name: "Year 8" }).click();
  await page.getByRole("button", { name: "Plan it" }).click();
  await expect(page).toHaveURL(/\/l\/[0-9a-f-]{36}$/);

  const banner = page.getByTestId("generating-banner");
  await expect
    .poll(() => page.locator("[data-slide-root]").count(), { timeout: 20_000 })
    .toBeGreaterThan(2);
  await expect(banner).toBeVisible();
  await page.screenshot({ path: "/tmp/teach-133-generating.png", fullPage: false });

  await expect(page.getByRole("button", { name: "Rename lesson" })).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/tmp/teach-133-editor.png", fullPage: false });

  await page.getByRole("button", { name: /thing(s)? to check$/ }).click();
  await expect(page.getByRole("list").filter({ hasText: "diagram" })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-133-residuals.png", fullPage: false });
});
