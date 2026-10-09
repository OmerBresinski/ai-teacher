/**
 * TEACH-101 part b PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-101-screenshots.spec.ts`.
 * Each activity fixture at KS1 and KS4 on the presenter's stage, question side and revealed, at
 * 1440 wide on the light theme, to `/tmp/teach-101-<stage>-<n>-<template>-<state>.png`.
 */
import { slideStepCount } from "@tj/domain/documents";
import { ACTIVITY_NAMES, activityLesson, servePhotos } from "./activity-lesson";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(300_000);

test("captures every activity template, question and revealed", async ({
  signedInPage: { page },
}) => {
  await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
  await servePhotos(page);
  const lessons = { ks1: activityLesson("ks1"), ks4: activityLesson("ks4") };
  const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
    headers: { origin: E2E_WEB_URL },
    data: {
      documents: Object.entries(lessons).map(([key, body]) => ({ key, kind: "lesson", body })),
    },
  });
  expect(res.ok()).toBe(true);
  const { ids } = (await res.json()) as { ids: Record<string, string> };
  for (const [stage, lesson] of Object.entries(lessons)) {
    for (const [i, slide] of lesson.slides.entries()) {
      const name = `/tmp/teach-101-${stage}-${i + 1}-${ACTIVITY_NAMES[i]}`;
      await page.goto(`/l/${ids[stage]}/present?slide=${i + 1}`);
      await expect(page.locator('[data-slide-mode="present"]')).toHaveCount(1);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${name}-question.png` });
      for (let k = 0; k < slideStepCount(slide); k++) await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${name}-revealed.png` });
    }
    // The editor with the answer drawer open on the choose slide.
    await page.goto(`/l/${ids[stage]}`);
    await page.getByRole("listbox", { name: "Slides" }).getByRole("option").nth(3).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `/tmp/teach-101-${stage}-editor-choose.png` });
  }
});
