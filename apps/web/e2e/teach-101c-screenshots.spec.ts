/**
 * TEACH-101 part c PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-101c-screenshots.spec.ts`.
 * The activity fixture lesson as the writer stage laid it out on a fake model
 * (`packages/generation/scripts/activity-writer-lesson.ts` writes `writer-lesson.json`): each
 * activity in the editor and on the presenter's stage, question side and revealed, at 1440 wide on
 * the light theme, to `/tmp/teach-101c-<n>-<state>.png`. Cards with no cached photo show their words.
 */
import { readFileSync } from "node:fs";
import type { Lesson, Slide } from "@tj/domain/documents";
import { slideStepCount } from "@tj/domain/documents";
import { newLesson } from "@tj/editor/starter";
import { PHOTO_DIR, servePhotos } from "./activity-lesson";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(300_000);

test("captures the writer's activity slides in the editor and Present", async ({
  signedInPage: { page },
}) => {
  await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
  await servePhotos(page);
  const { slides } = JSON.parse(readFileSync(new URL("writer-lesson.json", PHOTO_DIR), "utf8")) as {
    slides: Slide[];
  };
  const lesson: Lesson = { ...newLesson("Animals and their young", "splash"), slides };
  const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
    headers: { origin: E2E_WEB_URL },
    data: { documents: [{ key: "w", kind: "lesson", body: lesson }] },
  });
  expect(res.ok()).toBe(true);
  const { ids } = (await res.json()) as { ids: Record<string, string> };
  const rows = () => page.getByRole("listbox", { name: "Slides" }).getByRole("option");
  for (const [i, slide] of slides.entries()) {
    if (!slide.question) continue;
    const name = `/tmp/teach-101c-${i + 1}`;
    await page.goto(`/l/${ids.w}`);
    await rows().nth(i).click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${name}-editor.png` });
    await page.goto(`/l/${ids.w}/present?slide=${i + 1}`);
    await expect(page.locator('[data-slide-mode="present"]')).toHaveCount(1);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${name}-question.png` });
    for (let k = 0; k < slideStepCount(slide); k++) await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${name}-revealed.png` });
  }
});
