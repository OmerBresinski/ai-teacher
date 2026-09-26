/**
 * TEACH-94 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-94-screenshots.spec.ts`.
 *
 * Energy-profile diagram slides as Generate writes them (`materialiseSlide` from a diagram spec),
 * on Chalk and on Night Lab for a dark stage: an exothermic and an endothermic reaction, each in
 * the editor with the figure selected and on the presenter's stage, and a very exothermic one
 * whose peak is clamped and captioned "Not drawn to scale". The lessons are also exported to
 * PowerPoint from the Export dialog, for a render and a check in real PowerPoint.
 */
import type { Lesson } from "@tj/domain/documents";
import { materialiseSlide, newLesson } from "@tj/editor/starter";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 } });
test.setTimeout(180_000);

type Spec = Parameters<typeof materialiseSlide>[0];

const THEME_IDS = ["chalk", "night-lab"] as const;

const EXOTHERMIC: Spec = {
  kind: "diagram",
  heading: "Burning methane gives out energy",
  body: "The products end lower than the reactants, so the reaction transfers energy to the surroundings. Label the activation energy on the diagram.",
  figure: {
    template: "energy-profile",
    values: {
      reactants: "methane and oxygen",
      products: "carbon dioxide and water",
      activationEnergy: 50,
      energyChange: -90,
    },
  },
  factRefs: ["x1", "o2"],
};

const ENDOTHERMIC: Spec = {
  kind: "diagram",
  heading: "Heating limestone takes in energy",
  body: "The products end higher than the reactants, so the reaction takes in energy from the surroundings.",
  figure: {
    template: "energy-profile",
    values: {
      reactants: "calcium carbonate",
      products: "calcium oxide + CO2",
      activationEnergy: 120,
      energyChange: 40,
    },
  },
  factRefs: ["x2", "o2"],
};

/** A peak far below the energy change: drawn at least a quarter of the span up, captioned. */
const CLAMPED: Spec = {
  ...EXOTHERMIC,
  heading: "A small activation energy",
  body: "Hydrogen burns with a large energy change and a small activation energy.",
  figure: {
    template: "energy-profile",
    values: {
      reactants: "hydrogen and oxygen",
      products: "water",
      activationEnergy: 20,
      energyChange: -200,
    },
  },
};

const SLIDES = [
  { spec: EXOTHERMIC, name: "exothermic", heading: "Burning methane" },
  { spec: ENDOTHERMIC, name: "endothermic", heading: "Heating limestone" },
  { spec: CLAMPED, name: "clamped", heading: "A small activation energy" },
];

const META = {
  promptVersion: "generate-slide.v27",
  model: "fixture",
  at: "2026-09-26T12:00:00.000Z",
};

function profileLesson(themeId: string): Lesson {
  const lesson: Lesson = { ...newLesson("Energy changes", themeId), id: `t94-${themeId}` };
  lesson.slides = SLIDES.map(({ spec }) => materialiseSlide(spec, themeId, META));
  return lesson;
}

test("captures energy-profile slides in the editor and on the stage, on two themes, and the PowerPoint file", async ({
  signedInPage: { page },
}) => {
  await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
  const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
    headers: { origin: E2E_WEB_URL },
    data: {
      documents: THEME_IDS.map((id) => ({ key: id, kind: "lesson", body: profileLesson(id) })),
    },
  });
  expect(res.ok(), `seed failed: ${res.status()} ${await res.text()}`).toBe(true);
  const { ids } = (await res.json()) as { ids: Record<string, string> };

  for (const themeId of THEME_IDS) {
    const id = ids[themeId];
    for (const [i, { name, heading }] of SLIDES.entries()) {
      const n = i + 1;
      await page.goto(`/l/${id}`);
      const rows = page.getByRole("listbox", { name: "Slides" }).getByRole("option");
      await rows.nth(i).click();
      const figure = page.locator('[data-slide-frame] [data-element-type="group"]').first();
      await expect(figure).toBeVisible();
      await expect(page.locator("[data-slide-frame]").first()).toContainText(heading);
      const box = await figure.boundingBox();
      if (!box) throw new Error("no figure on the canvas");
      // The group's top-right corner is always empty: one click selects the figure as a whole.
      await page.mouse.click(box.x + box.width * 0.97, box.y + box.height * 0.03);
      await expect(page.locator("[data-selection-frame]")).toBeVisible();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `/tmp/teach-94-${themeId}-editor-${name}.png` });

      await page.goto(`/l/${id}/present?slide=${n}`);
      await page.getByRole("button", { name: "Stay in this window" }).click();
      await expect(page.locator('[data-slide-mode="present"]')).toHaveCount(1);
      await expect(page.getByRole("status").first()).toContainText(`Slide ${n} of`);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `/tmp/teach-94-${themeId}-stage-${name}.png` });
    }

    await page.goto(`/l/${id}`);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export" });
    await dialog.getByRole("tab", { name: "PowerPoint" }).click();
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Export PowerPoint" }).click();
    await (await download).saveAs(`/tmp/teach-94-${themeId}.pptx`);
  }
});
