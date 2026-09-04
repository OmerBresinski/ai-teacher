/**
 * Accessibility gate (F18-R09): axe on every page we ship today — the sign-in form, the signed-in
 * home and the jobs dev page. Serious/critical violations fail; moderate/minor are reported.
 */
import { expectNoSeriousA11yViolations } from "./a11y";
import { expect, test } from "./fixtures";

test.describe("accessibility (axe)", () => {
  test("/sign-in has no serious or critical violations", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByText("Sign in to Teaching Journey")).toBeVisible();
    await expectNoSeriousA11yViolations(page, "/sign-in");
  });

  test("/ (signed in) has no serious or critical violations", async ({
    signedInPage: { page },
  }) => {
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expectNoSeriousA11yViolations(page, "/");
  });

  test("/dev/jobs has no serious or critical violations (idle and with events)", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/dev/jobs");
    await expect(page.getByText("Jobs / SSE demo", { exact: true })).toBeVisible();
    await expectNoSeriousA11yViolations(page, "/dev/jobs (idle)");

    await page.getByRole("button", { name: "Run ping" }).click();
    await expect(page.getByRole("list", { name: "Job events" })).toBeVisible();
    await expectNoSeriousA11yViolations(page, "/dev/jobs (with events)");
  });
});
