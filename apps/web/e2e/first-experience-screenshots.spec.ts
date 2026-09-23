/** Local first-experience visual references. Opt-in with TEACH_SCREENSHOTS=1. */
import { expect, test } from "@playwright/test";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
] as const) {
  test(`${viewport.name}: captures the brief, transition, worksheet choices and result`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "light" });
    await page.goto("/dev/first-experience");
    await expect(page.getByTestId("creation-brief")).toBeVisible();
    await page.screenshot({
      path: `/tmp/first-experience-${viewport.name}-brief.png`,
      fullPage: true,
    });

    await page
      .getByRole("button", { name: "Next" })
      .evaluate((button: HTMLButtonElement) => button.click());
    await page.waitForTimeout(120);
    await page.screenshot({ path: `/tmp/first-experience-${viewport.name}-mid-transition.png` });
    await expect(page.getByTestId("creation-objectives")).toBeVisible();

    await page.getByRole("button", { name: "Generate" }).click();
    await expect(page.getByTestId("creation-worksheet")).toBeVisible();
    await page.getByRole("button", { name: "Add another worksheet" }).click();
    await page.screenshot({
      path: `/tmp/first-experience-${viewport.name}-worksheets.png`,
      fullPage: true,
    });

    await page.getByRole("button", { name: "Make 2 worksheets" }).click();
    await expect(page.getByTestId("creation-generating")).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `/tmp/first-experience-${viewport.name}-result.png`,
      fullPage: true,
    });
  });
}
