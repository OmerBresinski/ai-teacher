/** TEACH-198 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-198-screenshots.spec.ts`. */
import type { Page } from "@playwright/test";
import { generatedLesson } from "@tj/domain/documents/fixtures";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 } });

const HEADING = "By the end of this lesson I can";

// The seeded demo lesson is laid out, so its objectives slide is what a teacher sees.
test("captures the objectives slide in the editor and in present mode", async ({
  signedInPage: { page, paths },
}) => {
  await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
  await page.goto(paths.lesson("demo-water-cycle"));
  await expect(page.getByRole("heading", { level: 1, name: "The water cycle" })).toBeVisible();
  await page.getByRole("listbox", { name: "Slides" }).getByRole("option").nth(1).click();
  await expect(page.getByText(HEADING).first()).toBeVisible();
  await expect(page.getByText("name the four stages of the water cycle").first()).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-198-objectives-slide.png" });

  await page.goto(paths.lesson("demo-water-cycle", "/present"));
  await page.getByRole("button", { name: "Stay in this window" }).click();
  await expect(page.getByRole("status").first()).toContainText("Slide 1 of");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("status").first()).toContainText("Slide 2 of");
  await expect(page.locator("[data-present-root]")).toContainText(HEADING);
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-198-present-objectives.png" });
});

test.describe("sheet header", () => {
  test.use({ seed: false });

  /** The generated water cycle fixture: the lesson whose first objective the ticket names. */
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

  test("captures the water cycle sheet header from the creation flow", async ({
    signedInPage: { page },
  }) => {
    const line = "I can describe the stages of the water cycle";
    await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
    await seedLesson(page);
    await page.goto("/worksheets/new");
    await expect(page.getByRole("list", { name: "Recent lessons" })).toBeVisible();
    await page.getByRole("button", { name: /^The water cycle\./ }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator(".ws-mini .ws-page")).toHaveCount(9);
    await expect(page.locator('[data-recipe="exit-ticket"] .ws-objective')).toHaveText(line);
    await page.getByRole("button", { name: /^Exit ticket\./ }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/w\/[^/]+$/);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect(page.locator(".ws-column .ws-objective").first()).toHaveText(line);
    await page.waitForTimeout(500);
    await page.screenshot({ path: "/tmp/teach-198-sheet-header.png" });
  });
});
