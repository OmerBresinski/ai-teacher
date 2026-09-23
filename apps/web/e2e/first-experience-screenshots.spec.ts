/** Local first-experience visual references. Opt-in with TEACH_SCREENSHOTS=1. */
import { expect, test } from "@playwright/test";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");

async function settleFiniteAnimations(page: import("@playwright/test").Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

async function captureMotionSequence(page: import("@playwright/test").Page, name: string) {
  let elapsed = 0;
  for (const at of [500, 900, 1_350, 2_300]) {
    await page.waitForTimeout(at - elapsed);
    await page.screenshot({ path: `/tmp/${name}-${at}ms.png` });
    elapsed = at;
  }
}

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
    await settleFiniteAnimations(page);
    await page.screenshot({
      path: `/tmp/first-experience-${viewport.name}-brief.png`,
      fullPage: true,
    });

    await page
      .getByRole("button", { name: "Skip planning" })
      .evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByRole("combobox", { name: "Activity type" })).toBeEnabled();
    await captureMotionSequence(page, `first-experience-${viewport.name}-plan-to-worksheet`);
    await page.getByRole("button", { name: "Back to objectives" }).click();
    await page.getByRole("button", { name: "Back to the brief" }).click();
    await settleFiniteAnimations(page);

    await page
      .getByRole("button", { name: "Next" })
      .evaluate((button: HTMLButtonElement) => button.click());
    await page.waitForTimeout(120);
    await page.screenshot({ path: `/tmp/first-experience-${viewport.name}-mid-transition.png` });
    await expect(page.getByTestId("creation-objectives")).toBeVisible();

    await page.getByRole("button", { name: "Generate" }).click();
    await expect(page.getByTestId("creation-worksheet")).toBeVisible();
    await page.getByRole("button", { name: "Add another worksheet" }).click();
    await settleFiniteAnimations(page);
    await page.screenshot({
      path: `/tmp/first-experience-${viewport.name}-worksheets.png`,
      fullPage: true,
    });

    await page
      .getByRole("button", { name: "Just the slides" })
      .evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByRole("button", { name: "Back to worksheets" })).toBeEnabled();
    await captureMotionSequence(page, `first-experience-${viewport.name}-worksheet-to-slides`);
    await page.waitForTimeout(900);
    await page.screenshot({
      path: `/tmp/first-experience-${viewport.name}-slides-working-loop-a.png`,
    });
    await page.waitForTimeout(1_000);
    await page.screenshot({
      path: `/tmp/first-experience-${viewport.name}-slides-working-loop-b.png`,
    });

    await page.getByRole("button", { name: "Back to worksheets" }).click();
    await settleFiniteAnimations(page);

    await page.getByRole("button", { name: "Make 2 worksheets" }).click();
    await expect(page.getByTestId("creation-generating")).toBeVisible();
    await settleFiniteAnimations(page);
    await page.screenshot({
      path: `/tmp/first-experience-${viewport.name}-result.png`,
      fullPage: true,
    });
  });
}
