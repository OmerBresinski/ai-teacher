/**
 * TEACH-164 spike screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-164-screenshots.spec.ts`.
 *
 * Four diagram slides (ADR 0032) on two themes — a right-angled triangle drawn to scale, one
 * clamped ("Not drawn to scale"), an exothermic and an endothermic energy profile — shot in the
 * editor (with the figure selected as one group) and on the presenter's stage, then exported to
 * PowerPoint so the `.pptx` can be opened in Keynote and PowerPoint.
 */
import { copyFileSync } from "node:fs";
import type { Lesson, Slide } from "@tj/domain/documents";
import {
  diagramSlideElements,
  energyProfileFigure,
  FIGURE_RECT,
  getTheme,
  newLesson,
  rightTriangleFigure,
} from "@tj/editor/starter";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 } });
test.setTimeout(240_000);

const THEMES = ["chalk", "night-lab"] as const;

function diagramLesson(key: string, themeId: string): Lesson {
  const t = getTheme(themeId);
  const slide = (n: number, elements: Slide["elements"]): Slide => ({
    id: `${key}-s${n}`,
    kind: "content",
    elements,
  });
  const triangle = (base: number, height: number) =>
    rightTriangleFigure(
      t,
      {
        base: { length: base, label: `${base} cm` },
        height: { length: height, label: `${height} cm` },
        hypotenuse: { label: "x" },
      },
      FIGURE_RECT,
    );
  const profile = (activationEnergy: number, energyChange: number) =>
    energyProfileFigure(
      t,
      { reactants: "Reactants", products: "Products", activationEnergy, energyChange },
      FIGURE_RECT,
    );
  const lesson: Lesson = { ...newLesson("Figures spike", themeId), id: key };
  lesson.slides = [
    slide(
      1,
      diagramSlideElements(t, triangle(3, 4), {
        caption: "PYTHAGORAS",
        heading: "Find the hypotenuse",
        body: "Use a² + b² = c² to find x.",
      }),
    ),
    slide(
      2,
      diagramSlideElements(t, triangle(7, 24), {
        caption: "PYTHAGORAS",
        heading: "A steep triangle",
        body: "7 and 24 are drawn closer than they are. Find x.",
      }),
    ),
    slide(
      3,
      diagramSlideElements(t, profile(50, -90), {
        caption: "ENERGY CHANGES",
        heading: "An exothermic reaction",
        body: "The products have less energy than the reactants.",
      }),
    ),
    slide(
      4,
      diagramSlideElements(t, profile(120, 40), {
        caption: "ENERGY CHANGES",
        heading: "An endothermic reaction",
        body: "The products have more energy than the reactants.",
      }),
    ),
  ];
  return lesson;
}

test("captures the diagram slides in the editor, on the stage and in PowerPoint", async ({
  signedInPage: { page },
}) => {
  await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
  const documents = THEMES.map((themeId) => ({
    key: `t164-${themeId}`,
    kind: "lesson",
    body: diagramLesson(`t164-${themeId}`, themeId),
  }));
  const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
    headers: { origin: E2E_WEB_URL },
    data: { documents },
  });
  expect(res.ok(), `seed failed: ${res.status()} ${await res.text()}`).toBe(true);
  const { ids } = (await res.json()) as { ids: Record<string, string> };

  for (const themeId of THEMES) {
    const id = ids[`t164-${themeId}`];

    // Editor: each slide, the first with its figure clicked, which selects the whole group.
    await page.goto(`/l/${id}`);
    for (let n = 1; n <= 4; n++) {
      await page
        .getByLabel(new RegExp(`^Slide ${n}, `))
        .first()
        .click();
      await page.waitForTimeout(500);
      if (n === 1) {
        const canvas = page.locator('[data-slide-mode="edit"]').first();
        const box = await canvas.boundingBox();
        if (box) await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.62);
        await page.waitForTimeout(300);
      }
      await page.screenshot({ path: `/tmp/teach-164-editor-${themeId}-${n}.png` });
    }

    // Stage: the slides as a class sees them.
    for (let n = 1; n <= 4; n++) {
      await page.goto(`/l/${id}/present?slide=${n}`);
      await page.getByRole("button", { name: "Stay in this window" }).click();
      await expect(page.locator('[data-slide-mode="present"]')).toHaveCount(1);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `/tmp/teach-164-stage-${themeId}-${n}.png` });
    }

    // PowerPoint: the export dialog, saved for Keynote / PowerPoint.
    await page.goto(`/l/${id}`);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export" });
    await dialog.getByRole("tab", { name: "PowerPoint" }).click();
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Export PowerPoint" }).click();
    copyFileSync(await (await download).path(), `/tmp/teach-164-${themeId}.pptx`);
  }
});
