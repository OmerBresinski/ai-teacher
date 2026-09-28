/**
 * TEACH-77 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-77-screenshots.spec.ts`.
 *
 * A diagram slide on two themes (Chalk, and Night Lab for a dark stage): in the editor with the
 * figure selected as one group, and on the presenter's stage, each with the placeholder 3-4-x
 * triangle and a clamped 7-24 triangle captioned "Not drawn to scale".
 */
import type { Lesson } from "@tj/domain/documents";
import { drawFigure, FIGURE_RECT, getTheme, newLesson, newSlide } from "@tj/editor/starter";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 } });
test.setTimeout(120_000);

const THEME_IDS = ["chalk", "night-lab"] as const;

function diagramLesson(themeId: string): Lesson {
  const lesson: Lesson = { ...newLesson("Pythagoras' theorem", themeId), id: `t77-${themeId}` };
  const clamped = newSlide("diagram", themeId);
  clamped.elements[0] = drawFigure(
    "right-triangle",
    {
      base: { length: 7, label: "7 cm" },
      height: { length: 24, label: "24 cm" },
      hypotenuse: { label: "x" },
    },
    getTheme(themeId),
    FIGURE_RECT,
  );
  lesson.slides = [newSlide("diagram", themeId), clamped];
  return lesson;
}

test("captures the diagram slide in the editor and on the stage, on two themes", async ({
  signedInPage: { page },
}) => {
  await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
  const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
    headers: { origin: E2E_WEB_URL },
    data: {
      documents: THEME_IDS.map((id) => ({ key: id, kind: "lesson", body: diagramLesson(id) })),
    },
  });
  expect(res.ok(), `seed failed: ${res.status()} ${await res.text()}`).toBe(true);
  const { ids } = (await res.json()) as { ids: Record<string, string> };

  for (const themeId of THEME_IDS) {
    const id = ids[themeId];
    for (const n of [1, 2]) {
      const which = n === 1 ? "placeholder" : "clamped";
      await page.goto(`/l/${id}`);
      const rows = page.getByRole("listbox", { name: "Slides" }).getByRole("option");
      await rows.nth(n - 1).click();
      const figure = page.locator('[data-slide-frame] [data-element-type="group"]').first();
      await expect(figure).toBeVisible();
      const box = await figure.boundingBox();
      if (!box) throw new Error("no figure on the canvas");
      // The group's own frame, not a label: one click selects the figure as a whole.
      await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.6);
      await expect(page.locator("[data-selection-frame]")).toBeVisible();
      await expect(page.locator("[data-handle]")).toHaveCount(8);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `/tmp/teach-77-${themeId}-editor-${which}.png` });

      await page.goto(`/l/${id}/present?slide=${n}`);
      await expect(page.locator('[data-slide-mode="present"]')).toHaveCount(1);
      await expect(page.getByRole("status").first()).toContainText(`Slide ${n} of`);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `/tmp/teach-77-${themeId}-stage-${which}.png` });
    }
  }
});
