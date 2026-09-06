/**
 * Dev-only kit gate. Run `E2E_KIT=1 bunx playwright test --project=kit` to start the dedicated
 * Vite development server on :4194; add `TEACH_SCREENSHOTS=1` to write the three visual
 * references. Normal production e2e deliberately does not register this project because a
 * production build must not contain `/kit`.
 */
import { expectNoSeriousA11yViolations } from "./a11y";
import { expect, test } from "./fixtures";

test.describe("/kit (Vite development build)", () => {
  test.skip(process.env.E2E_KIT !== "1", "set E2E_KIT=1 to run the dev-only kit gate");
  const captureScreenshots = process.env.TEACH_SCREENSHOTS === "1";

  test("renders the gallery, tracks sections, passes axe in every explicit theme, and captures references", async ({
    signedInPage: { page },
  }) => {
    await expect(page.getByRole("link", { name: "Kit" })).toBeVisible();
    await page.goto("/kit");
    await expect(page.getByRole("heading", { level: 1, name: "The kit" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link")).toHaveCount(
      10,
    );
    await expect(page.getByRole("link", { name: "Foundations" })).toHaveAttribute(
      "aria-current",
      "true",
    );

    await expectNoSeriousA11yViolations(page, "/kit (light)");
    if (captureScreenshots) {
      await page.screenshot({ path: "/tmp/teach-93-light.png", fullPage: true });
    }

    await page.getByRole("tab", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expectNoSeriousA11yViolations(page, "/kit (dark)");
    if (captureScreenshots) {
      await page.screenshot({ path: "/tmp/teach-93-dark.png", fullPage: true });
    }

    await page.getByRole("tab", { name: "High contrast" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "high-contrast");
    await expectNoSeriousA11yViolations(page, "/kit (high contrast)");
    if (captureScreenshots) {
      await page.screenshot({ path: "/tmp/teach-93-hc.png", fullPage: true });
    }

    await page.locator("#content").scrollIntoViewIfNeeded();
    await expect(page.getByRole("link", { name: "Content" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });
});
