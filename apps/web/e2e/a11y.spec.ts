/**
 * Accessibility gate (F18-R09): axe on every route we ship, in each of the three themes, plus the
 * open state of every dialog and the card menu. Serious/critical violations fail; moderate/minor
 * are reported. The theme is set through `localStorage` before the pre-paint script runs
 * (`addInitScript` precedes every page script), so each scan sees the final colours.
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
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
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

  const THEMES = ["light", "dark", "high-contrast"] as const;
  const ROUTES: { path: string; ready: RegExp | string }[] = [
    { path: "/", ready: "Home" },
    { path: "/lessons", ready: "Lessons" },
    { path: "/worksheets", ready: "Worksheets" },
    { path: "/series", ready: "Series" },
    { path: "/series/series-romans", ready: "The Romans" },
    { path: "/l/demo-water-cycle", ready: /\d+ slides/ },
    { path: "/l/demo-water-cycle/present", ready: "Start presenting" },
    { path: "/w/fraction-practice/print", ready: "The editor arrives with @tj/editor" },
  ];

  for (const theme of THEMES) {
    test(`every route is clean in the ${theme} theme`, async ({ signedInPage: { page } }) => {
      await page.addInitScript((value) => localStorage.setItem("tj-theme", value), theme);
      for (const route of ROUTES) {
        await page.goto(route.path);
        await expect(page.getByText(route.ready).first()).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expectNoSeriousA11yViolations(page, `${route.path} (${theme})`);
      }
    });
  }

  test("open overlays are clean: create dialogs, card menu, series row menu", async ({
    signedInPage: { page },
  }) => {
    // Dialogs and menus arrive over 450 ms; axe reads contrast through the fade, so wait for every
    // running animation on the surface (or its inner wrapper) to finish rather than for a fixed time.
    const settled = async () => {
      const surface = page.locator('[role="dialog"], [role="menu"]').last();
      await surface.evaluate((el) =>
        Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished)),
      );
    };
    for (const label of ["New lesson", "New worksheet", "New series"]) {
      await page.getByRole("button", { name: label }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await settled();
      await expectNoSeriousA11yViolations(page, `${label} dialog`, '[role="dialog"]');
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }

    await page.goto("/lessons");
    const card = page.locator("article").first();
    await card.hover();
    await card.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await settled();
    await expectNoSeriousA11yViolations(page, "card menu", '[role="menu"]');
    await page.keyboard.press("Escape");

    await page.goto("/series/series-romans");
    await page.getByRole("button", { name: "Add lesson" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await settled();
    await expectNoSeriousA11yViolations(page, "Add lessons dialog", '[role="dialog"]');
  });
});
