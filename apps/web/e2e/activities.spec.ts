/**
 * TEACH-101 part b, tagged @smoke: a teacher presents and exports activity slides. The six activity
 * templates render in the editor, each reveals its answer in Present (the answer is question data,
 * hidden until the last step) and the lesson exports to PowerPoint. A `bun test` cannot cover the
 * reveal across Present's real key handling or the browser-side export.
 */
import { answerRevealSteps, slideStepCount } from "@tj/domain/documents";
import { ACTIVITY_NAMES, activityLesson, servePhotos } from "./activity-lesson";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test("activity slides render, reveal in Present and export @smoke", { tag: "@smoke" }, async ({
  signedInPage: { page },
}) => {
  test.setTimeout(90_000);
  await servePhotos(page);
  const lesson = activityLesson("ks1");
  const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
    headers: { origin: E2E_WEB_URL },
    data: { documents: [{ key: "act", kind: "lesson", body: lesson }] },
  });
  expect(res.ok(), `seed failed: ${res.status()}`).toBe(true);
  const { ids } = (await res.json()) as { ids: Record<string, string> };
  const id = ids.act as string;

  await page.goto(`/l/${id}`);
  const rows = page.getByRole("listbox", { name: "Slides" }).getByRole("option");
  await expect(rows).toHaveCount(ACTIVITY_NAMES.length);
  for (const [i, slide] of lesson.slides.entries()) {
    await rows.nth(i).click();
    const heading = slide.elements.find((e) => e.name === "Heading");
    const words =
      heading && "doc" in heading ? JSON.stringify(heading.doc).match(/"text":"([^"]+)"/)?.[1] : "";
    await expect(page.locator("[data-slide-frame]").first()).toContainText(words ?? "");
  }

  // Present: each slide hides its answer until its last step, then shows it.
  for (const [i, slide] of lesson.slides.entries()) {
    await page.goto(`/l/${id}/present?slide=${i + 1}`);
    const stage = page.locator('[data-slide-mode="present"]');
    await expect(stage).toHaveCount(1);
    expect(answerRevealSteps(slide)).toBeGreaterThan(0);
    const answer =
      slide.question?.type === "multiple-choice"
        ? stage.locator('[data-choice-mark="right"]')
        : slide.question?.type === "sort"
          ? stage.getByText("1", { exact: true }).locator("xpath=self::span[@data-answer-anim]")
          : slide.question?.type === "fill-gap"
            ? stage.locator('.td-gap[data-revealed="true"]').first()
            : stage.locator("[data-answer-anim]").first();
    await expect(answer).toHaveCount(0);
    for (let k = 0; k < slideStepCount(slide); k++) await page.keyboard.press("ArrowRight");
    await expect(answer.first()).toBeVisible();
  }

  await page.goto(`/l/${id}`);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export" });
  await dialog.getByRole("tab", { name: "PowerPoint" }).click();
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export PowerPoint" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pptx$/);
});
