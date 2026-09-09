/** TEACH-198 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-198-screenshots.spec.ts`. */
import type { Page } from "@playwright/test";
import { generatedLesson } from "@tj/domain/documents/fixtures";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 }, seed: false });

const HEADING = "By the end of this lesson I can";
const HEADER_LINE = "I can describe the stages of the water cycle";

/** The generated water cycle fixture: a lesson with facts, its objectives slide built from them. */
async function seedLesson(page: Page): Promise<string> {
  const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
    headers: { origin: E2E_WEB_URL },
    data: {
      documents: [
        {
          key: "lesson",
          kind: "lesson",
          body: { ...generatedLesson(), updatedAt: new Date().toISOString() },
        },
      ],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const { ids } = (await res.json()) as { ids: Record<string, string> };
  if (!ids.lesson) throw new Error("seed");
  return ids.lesson;
}

test("captures the objectives slide in the editor, in present mode, and the sheet header", async ({
  signedInPage: { page },
}) => {
  await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
  const lessonId = await seedLesson(page);

  await page.goto(`/l/${lessonId}`);
  await expect(page.getByRole("heading", { level: 1, name: "The water cycle" })).toBeVisible();
  await page.getByRole("listbox", { name: "Slides" }).getByRole("option").nth(1).click();
  await expect(page.getByText(HEADING).first()).toBeVisible();
  await expect(page.getByText("describe the stages of the water cycle").first()).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-198-objectives-slide.png" });

  await page.goto(`/l/${lessonId}/present`);
  await expect(page.locator("[data-present-root]")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("[data-present-root]")).toContainText(HEADING);
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-198-present-objectives.png" });

  await page.goto("/worksheets/new");
  await expect(page.getByRole("list", { name: "Recent lessons" })).toBeVisible();
  await page.getByRole("button", { name: /^The water cycle\./ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".ws-mini .ws-page")).toHaveCount(9);
  await expect(page.locator('[data-recipe="exit-ticket"] .ws-objective')).toHaveText(HEADER_LINE);
  await page.getByRole("button", { name: /^Exit ticket\./ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/w\/[^/]+$/);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.locator(".ws-column .ws-objective").first()).toHaveText(HEADER_LINE);
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/teach-198-sheet-header.png" });
});
