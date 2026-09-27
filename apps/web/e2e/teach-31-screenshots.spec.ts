/** TEACH-31 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-31-screenshots.spec.ts`. */
import { expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 } });

test("captures /sign-in with Continue with Google, then the not-set-up alert", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
  await page.goto("/sign-in?redirect=%2Flessons");
  const google = page.getByRole("button", { name: "Continue with Google" });
  await expect(google).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-31-sign-in.png" });

  // e2e runs the api with Google off (playwright.config.ts), so the click answers 404.
  await google.click();
  await expect(page.getByRole("alert")).toHaveText(
    "Google sign-in is not set up here. Use the email link below.",
  );
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-31-not-set-up.png" });
});
