/** TEACH-198 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-198-screenshots.spec.ts`. */
import type { Page } from "@playwright/test";
import type { Lesson, RichNode } from "@tj/domain/documents";
import { generatedLesson } from "@tj/domain/documents/fixtures";
import { demoWorkspace } from "@tj/editor/starter";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 } });

const HEADING = "By the end of this lesson I can";

/** The present view with the cover gone and slide `n` on the stage. */
async function presentSlide(page: Page, url: string, n: number): Promise<void> {
  await page.goto(`${url}?slide=${n}`);
  await page.getByRole("button", { name: "Stay in this window" }).click();
  await expect(page.getByRole("button", { name: "Stay in this window" })).toBeHidden();
  await expect(page.getByRole("status").first()).toContainText(`Slide ${n} of`);
  const stage = page.locator('[data-slide-mode="present"]');
  await expect(stage).toHaveCount(1);
  await expect(stage).toContainText(HEADING);
  // The slide fades in once; let the fade and the controls' hover state settle.
  await page.waitForTimeout(700);
}

type Fit = {
  /** Rendered lines per objective at the slide's body size. */
  lines: number[];
  /** The body element's stored box and its rendered content, in slide units (960 wide). */
  boxH: number;
  contentH: number;
  /** Whether the rendered body stays inside the slide's safe area. */
  onSlide: boolean;
};

/**
 * How the numbered body of the objectives slide on the stage renders: lines per objective, the
 * stored box against the content (text boxes are auto-height, so content past the box grows the
 * box rather than clipping) and whether it all stays on the slide.
 */
async function bodyFit(page: Page): Promise<Fit> {
  return page
    .locator('[data-slide-mode="present"] ol')
    .first()
    .evaluate((ol) => {
      const frame = ol.closest('[data-element-type="text"]');
      const slide = ol.closest('[data-slide-mode="present"]');
      if (!frame || !slide) throw new Error("numbered body has no frame or slide");
      const scale = 960 / slide.getBoundingClientRect().width;
      const box = frame.getBoundingClientRect();
      // Distinct line boxes of the paragraph's text, so wrapped lines are counted as rendered.
      const lines = Array.from(ol.querySelectorAll("li")).map((li) => {
        const range = document.createRange();
        range.selectNodeContents(li.querySelector("p") ?? li);
        const tops = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
        return tops.size;
      });
      const content = ol.getBoundingClientRect();
      const safeBottom = slide.getBoundingClientRect().bottom - 48 / scale;
      return {
        lines,
        boxH: Math.round(box.height * scale),
        contentH: Math.round((content.bottom - box.top) * scale),
        onSlide: content.bottom <= safeBottom,
      };
    });
}

// The seeded demo lesson is laid out, so its objectives slide is what a teacher sees.
test("captures the objectives slide in the editor, its rail thumbnail and present mode", async ({
  signedInPage: { page, paths },
}) => {
  await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
  await page.goto(paths.lesson("demo-water-cycle"));
  await expect(page.getByRole("heading", { level: 1, name: "The water cycle" })).toBeVisible();
  const rail = page.getByRole("listbox", { name: "Slides" });
  await rail.getByRole("option").nth(1).click();
  const canvas = page.locator('[data-slide-mode="edit"]');
  await expect(canvas).toContainText(HEADING);
  await expect(canvas).toContainText("name the four stages of the water cycle");
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/tmp/teach-198-objectives-slide.png" });
  // The rail thumbnail is the same static renderer a library card cover uses.
  await rail.getByRole("option").nth(1).screenshot({ path: "/tmp/teach-198-thumbnail.png" });

  await presentSlide(page, paths.lesson("demo-water-cycle", "/present"), 2);
  await page.screenshot({ path: "/tmp/teach-198-present-objectives.png" });
  const fit = await bodyFit(page);
  console.log(`TEACH-198 demo lesson fit: ${JSON.stringify(fit)}`);
  expect.soft(fit.onSlide, "objectives body runs off the slide").toBe(true);
});

test.describe("seeded from the generated fixture", () => {
  test.use({ seed: false });

  async function seedLesson(page: Page, body: Lesson): Promise<string> {
    const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
      headers: { origin: E2E_WEB_URL },
      data: {
        documents: [
          { key: "lesson", kind: "lesson", body: { ...body, updatedAt: new Date().toISOString() } },
        ],
      },
    });
    expect(res.ok(), await res.text()).toBe(true);
    const { ids } = (await res.json()) as { ids: Record<string, string> };
    if (!ids.lesson) throw new Error("seed");
    return ids.lesson;
  }

  /**
   * The three longest objectives in any fixture (`DEMO_LESSON_FACTS`, 63 to 70 characters) in
   * the slide's rendered form, on the demo water cycle lesson's own objectives slide, which the
   * objectives recipe laid out.
   */
  const LONGEST = [
    "name the four stages of the water cycle in order",
    "explain how heat from the sun drives evaporation and condensation",
    "describe where the water in a river has been and where it goes next",
  ];

  /** The demo water cycle lesson with its three objective lines replaced, in order. */
  function withLongestObjectives(): Lesson {
    const demo = demoWorkspace(new Date()).find((d) => d.key === "demo-water-cycle");
    if (demo?.kind !== "lesson") throw new Error("demo lesson");
    const slide = demo.body.slides.find((s) => s.kind === "objectives");
    const body = slide?.elements.find((e) => e.type === "text" && e.style.preset === "body");
    if (!body || !("doc" in body) || !body.doc) throw new Error("objectives body");
    const queue = [...LONGEST];
    const walk = (node: RichNode) => {
      if (node.type === "text") node.text = queue.shift() ?? node.text;
      for (const child of node.content ?? []) walk(child);
    };
    walk(body.doc);
    if (queue.length > 0) throw new Error("fewer than three objective lines");
    return demo.body;
  }

  test("three of the longest objectives stay on the slide in present mode", async ({
    signedInPage: { page },
  }) => {
    await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
    const lesson = withLongestObjectives();
    const at = lesson.slides.findIndex((slide) => slide.kind === "objectives");
    const id = await seedLesson(page, lesson);
    await presentSlide(page, `/l/${id}/present`, at + 1);
    await expect(page.locator('[data-slide-mode="present"]')).toContainText(LONGEST[2] ?? "");
    const fit = await bodyFit(page);
    console.log(`TEACH-198 longest objectives fit: ${JSON.stringify(fit)}`);
    await page.screenshot({ path: "/tmp/teach-198-present-longest.png" });
    expect.soft(fit.onSlide, "objectives body runs off the slide").toBe(true);
  });

  test("captures the water cycle sheet header from the creation flow", async ({
    signedInPage: { page },
  }) => {
    const line = "I can describe the stages of the water cycle";
    await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
    await seedLesson(page, generatedLesson());
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
