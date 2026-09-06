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

  test("the stage scope stays dark in every theme, paints no ground, and reaches a portalled menu", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/kit");
    const stage = page.getByTestId("kit-stage");
    await stage.scrollIntoViewIfNeeded();

    const readTokens = () =>
      stage.evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          background: style.getPropertyValue("--background").trim(),
          card: style.getPropertyValue("--card").trim(),
          // Painted by the specimen's own `bg-background`, not by the scope.
          paint: style.backgroundColor,
        };
      });

    // The scope's values are the same under all three explicit themes (ADR 0022 §3, TEACH-97).
    for (const theme of ["Light", "Dark", "High contrast"] as const) {
      await page.getByRole("tab", { name: theme }).click();
      const tokens = await readTokens();
      expect(tokens.background, theme).toBe("#141312");
      expect(tokens.card, theme).toBe("#1f1d1b");
    }

    // A filled Button inside the scope paints the stage accent.
    const present = stage.getByRole("button", { name: "Present" });
    await expect(present).toHaveCSS("background-color", "rgb(210, 100, 75)");

    // The scope paints nothing itself: a bare `.tj-stage` node has a transparent background.
    const bare = await page.evaluate(() => {
      const el = document.createElement("div");
      el.className = "tj-stage";
      document.body.append(el);
      const color = getComputedStyle(el).backgroundColor;
      el.remove();
      return color;
    });
    expect(bare).toBe("rgba(0, 0, 0, 0)");

    // A portalled menu opened from the stage carries the class and the stage surface.
    await stage.getByRole("button", { name: "Stage menu" }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toHaveClass(/tj-stage/);
    await expect(menu).toHaveCSS("background-color", "rgb(31, 29, 27)");
    await page.keyboard.press("Escape");
  });
});
