/**
 * TEACH-199: the Checking state of the generating shell, from the kit's "Generating" exhibit on
 * the recorded run (the fake worker coalesces 90 and 100 into one event, so the page never
 * shows Checking for long enough to catch). Opt-in twice over, like `kit.spec.ts`:
 * `E2E_KIT=1 TEACH_SCREENSHOTS=1 bunx playwright test --project=kit e2e/teach-199-kit.spec.ts`.
 */
import { expect, test } from "./fixtures";

test.skip(process.env.E2E_KIT !== "1", "set E2E_KIT=1 to run the dev-only kit gate");
test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 } });

test("checking, on the kit exhibit", async ({ signedInPage: { page } }) => {
  await page.goto("/kit#chrome");
  const exhibit = page.getByTestId("generating-shell");
  await page.getByRole("tab", { name: "Checking" }).click();
  await expect(page.getByTestId("generating-stage")).toHaveText("Checking");
  await expect(exhibit.locator('[data-stage="checking"]')).toHaveAttribute("data-status", "live");
  await exhibit.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-199-checking.png" });
});
