/**
 * TEACH-201: the time estimate exhibit on `/kit`. Runs in the dev-only kit project
 * (`E2E_KIT=1 bunx playwright test --project=kit`); `TEACH_SCREENSHOTS=1` writes the reference
 * PNG for the PR at 1440 by 1000.
 *
 * The file name is load-bearing: `playwright.config.ts` routes `*kit.spec.ts` to the kit project
 * and keeps it out of `chromium`, whose production build has no `/kit`. Keep the suffix.
 */
import { expect, test } from "./fixtures";

test.describe("/kit time estimate (TEACH-201)", () => {
  test("shows the range with history, nothing without, and the late state past the bound", async ({
    signedInPage: { page },
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/kit#feedback");
    const specimen = page.getByRole("heading", { name: "Time estimate" }).locator("xpath=../..");
    await specimen.scrollIntoViewIfNeeded();

    const estimates = specimen.getByTestId("generation-estimate");
    // With history: a range. No history: nothing, the stage line alone. Stalled: the late text.
    await expect(estimates).toHaveCount(2);
    await expect(estimates.nth(0)).toHaveAttribute("data-state", "range");
    await expect(estimates.nth(0)).toHaveText(/^(About|Less than) .* left$/);
    await expect(estimates.nth(1)).toHaveAttribute("data-state", "late");
    await expect(estimates.nth(1)).toHaveText("Taking longer than usual");
    await expect(specimen.getByText("Writing the slides and pictures, 3 of 8")).toHaveCount(3);

    if (process.env.TEACH_SCREENSHOTS === "1") {
      await specimen.screenshot({ path: "/tmp/teach-201-kit-estimate.png" });
    }
  });
});
