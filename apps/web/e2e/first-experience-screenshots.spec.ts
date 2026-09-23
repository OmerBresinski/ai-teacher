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
    test.setTimeout(55_000);
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
    await settleFiniteAnimations(page);
    await page.screenshot({
      path: `/tmp/first-experience-${viewport.name}-objectives.png`,
      fullPage: true,
    });

    await page.getByRole("button", { name: "Continue" }).click();
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
    const editorPreview = page.getByTestId("creation-generating");
    await expect(editorPreview).toHaveAttribute("data-preview-state", "empty");
    await page.screenshot({
      path: `/tmp/first-experience-${viewport.name}-editor-empty.png`,
      fullPage: true,
    });
    await captureMotionSequence(page, `first-experience-${viewport.name}-worksheet-to-slides`);
    await page.waitForTimeout(900);
    await page.screenshot({
      path: `/tmp/first-experience-${viewport.name}-slides-working-loop-a.png`,
    });
    await page.waitForTimeout(1_000);
    await page.screenshot({
      path: `/tmp/first-experience-${viewport.name}-slides-working-loop-b.png`,
    });
    await expect(editorPreview).toHaveAttribute("data-preview-state", "partial", {
      timeout: 5_000,
    });
    await page.screenshot({
      path: `/tmp/first-experience-${viewport.name}-editor-partial.png`,
      fullPage: true,
    });
    await expect(editorPreview).toHaveAttribute("data-preview-state", "ready", {
      timeout: 25_000,
    });
    const readySlides = page.getByRole("listbox", { name: "Slides" }).getByRole("option");
    await expect(readySlides.last()).toHaveAttribute("aria-selected", "true");
    await page.screenshot({
      path: `/tmp/first-experience-${viewport.name}-editor-ready.png`,
      fullPage: true,
    });
  });
}

test("short desktop keeps the populated Slides actor clear of the lock line", async ({ page }) => {
  test.setTimeout(15_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/dev/first-experience");
  await page.getByRole("button", { name: "Skip planning" }).click();
  await page.getByRole("button", { name: "Just the slides" }).click();
  const preview = page.getByTestId("creation-generating");
  await expect(preview).toHaveAttribute("data-preview-state", "partial", { timeout: 7_000 });

  const actorBody = await page
    .locator('[data-canvas-companion] .person[data-actor="1"] .body')
    .boundingBox();
  const lock = await page.getByTestId("generating-lock").boundingBox();
  await page.screenshot({ path: "/tmp/first-experience-short-desktop-editor-partial.png" });
  if (!actorBody || !lock) throw new Error("short-desktop layout missing");
  expect(actorBody.y).toBeGreaterThanOrEqual(lock.y + lock.height);
});
