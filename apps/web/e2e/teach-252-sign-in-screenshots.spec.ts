/**
 * TEACH-252 PR screenshots of the redesigned /sign-in. Opt-in:
 * `TEACH_SCREENSHOTS=1 … e2e/teach-252-sign-in-screenshots.spec.ts`. (`teach-252-screenshots` is
 * the donor issue's navigator spec.)
 */
import type { Page } from "@playwright/test";
import { expect, test, uniqueEmail } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");

const DESKTOP = { width: 1440, height: 1000 };
const PHONE = { width: 390, height: 844 };

async function open(page: Page, theme: string, path = "/sign-in") {
  await page.addInitScript((value) => localStorage.setItem("tj-theme", value), theme);
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "Welcome to DayBack" })).toBeVisible();
}

// The mark's rewind (CSS) and the cast's arrival and hello (GSAP, about 2.5 s) play once; shoot the
// page after both. The cast keeps breathing, so no two shots are pixel-identical.
async function shoot(page: Page, name: string) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `/tmp/teach-252-sign-in-${name}.png` });
}

for (const theme of ["light", "dark", "high-contrast"]) {
  test(`captures /sign-in at 1440 in ${theme}`, async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await open(page, theme, "/sign-in?redirect=%2Flessons");
    await shoot(page, theme);
  });
}

test("captures /sign-in on a 390 phone", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await open(page, "light");
  await shoot(page, "390");
});

test("captures the sent state", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await open(page, "light");
  await page.getByLabel("Email address").fill(uniqueEmail("teacher"));
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("status")).toHaveText(/Check your inbox/);
  await shoot(page, "sent");
});

test("captures a failed round trip: ?error=INVALID_TOKEN", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await open(page, "light", "/sign-in?error=INVALID_TOKEN");
  await expect(page.getByRole("alert")).toBeVisible();
  await shoot(page, "error");
});
