/**
 * Settings page (TEACH-33 part a): reached from the sidebar, it shows the account in full and is
 * the one place the app theme changes. A long school email wraps inside its column rather than
 * being cut off, at desktop and phone widths alike.
 */
import { expect, signIn, test } from "./fixtures";

const LONG_EMAIL = `head.of.science.and.computing-${Date.now().toString(36)}@a-very-long-school-name.example.test`;

for (const width of [1440, 390]) {
  test(`a long email is shown in full at ${width} px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page, request, LONG_EMAIL.replace("@", `-${width}@`));
    await page.goto("/settings");
    const email = page.getByText(/^head\.of\.science.*example\.test$/);
    await expect(email).toBeVisible();
    // Not clipped: the text fits its own box, and its box fits the window.
    const fit = await email.evaluate((el) => ({
      clipped: el.scrollWidth > el.clientWidth,
      right: el.getBoundingClientRect().right,
    }));
    expect(fit.clipped).toBe(false);
    expect(fit.right).toBeLessThanOrEqual(width);
  });
}

test("the sidebar opens Settings, and the theme changes there", async ({
  signedInPage: { page },
}) => {
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
