/**
 * TEACH-89 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-89-diagram-screenshots.spec.ts`
 * (`teach-89-screenshots.spec.ts` is older work filed under the same issue number).
 *
 * A diagram slide as Generate writes it: the fixture spec the fake AI answers a diagram call with
 * (`packages/generation/src/fixtures/slides.json`, "diagram") through `materialiseSlide`, on Chalk
 * and on Night Lab for a dark stage. Each is shown in the editor with the figure selected and on
 * the presenter's stage, beside the same slide from an answer whose sides break a² + b² = c² (drawn
 * from its two legs and captioned "Not drawn to scale"; Generate flags it for Repair).
 */
import type { Lesson } from "@tj/domain/documents";
import { materialiseSlide, newLesson } from "@tj/editor/starter";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 } });
test.setTimeout(120_000);

type Spec = Parameters<typeof materialiseSlide>[0];

const THEME_IDS = ["chalk", "night-lab"] as const;

/** The fixture spec, as `slides.json` has it. */
const DIAGRAM: Spec = {
  kind: "diagram",
  heading: "Find the hypotenuse",
  body: "The two shorter sides meet at a right angle. They are 3 cm and 4 cm long. Use Pythagoras' theorem to find x.",
  figure: {
    template: "right-triangle",
    values: {
      base: { length: 3, label: "3 cm" },
      height: { length: 4, label: "4 cm" },
      hypotenuse: { label: "x" },
    },
  },
  factRefs: ["x1", "o2"],
  notes:
    "Ask which side is the hypotenuse before anyone calculates: it is opposite the right angle. x = 5 cm.",
};

/** An answer whose three lengths disagree: accepted after its retry, drawn not to scale. */
const DISAGREEING: Spec = {
  ...DIAGRAM,
  heading: "Check the hypotenuse",
  body: "The two shorter sides are 3 cm and 4 cm. Is 6 cm the right length for the longest side?",
  figure: {
    template: "right-triangle",
    values: {
      base: { length: 3, label: "3 cm" },
      height: { length: 4, label: "4 cm" },
      hypotenuse: { length: 6, label: "6 cm" },
    },
  },
};

const META = {
  promptVersion: "generate-slide.v26",
  model: "fixture",
  at: "2026-09-26T12:00:00.000Z",
};

function diagramLesson(themeId: string): Lesson {
  const lesson: Lesson = { ...newLesson("Pythagoras' theorem", themeId), id: `t89-${themeId}` };
  lesson.slides = [
    materialiseSlide(DIAGRAM, themeId, META),
    materialiseSlide(DISAGREEING, themeId, META),
  ];
  return lesson;
}

test("captures a generated diagram slide in the editor and on the stage, on two themes", async ({
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
      const which = n === 1 ? "generated" : "not-to-scale";
      await page.goto(`/l/${id}`);
      const rows = page.getByRole("listbox", { name: "Slides" }).getByRole("option");
      await rows.nth(n - 1).click();
      const figure = page.locator('[data-slide-frame] [data-element-type="group"]').first();
      await expect(figure).toBeVisible();
      await expect(page.locator("[data-slide-frame]").first()).toContainText(
        n === 1 ? "Find the hypotenuse" : "Check the hypotenuse",
      );
      const box = await figure.boundingBox();
      if (!box) throw new Error("no figure on the canvas");
      // The group's own frame, not a label: one click selects the figure as a whole.
      await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.6);
      await expect(page.locator("[data-selection-frame]")).toBeVisible();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `/tmp/teach-89-diagram-${themeId}-editor-${which}.png` });

      await page.goto(`/l/${id}/present?slide=${n}`);
      await expect(page.locator('[data-slide-mode="present"]')).toHaveCount(1);
      await expect(page.getByRole("status").first()).toContainText(`Slide ${n} of`);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `/tmp/teach-89-diagram-${themeId}-stage-${which}.png` });
    }
  }
});
