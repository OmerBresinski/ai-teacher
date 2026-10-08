/**
 * TEACH-221 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-221-screenshots.spec.ts`.
 *
 * Four `triangle` diagram specs through `materialiseSlide` in the layout the template picks (a
 * similar pair asks for `figure-wide`): right-angled trigonometry, the cosine rule, an isosceles
 * triangle and a similar pair, on Chalk and on Night Lab for a dark stage, each in the editor with
 * the figure selected and on the presenter's stage, then exported to PowerPoint for a Quick Look
 * render.
 */
import type { Lesson } from "@tj/domain/documents";
import { materialiseSlide, newLesson } from "@tj/editor/starter";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.use({ viewport: { width: 1440, height: 1000 } });
test.setTimeout(300_000);

type Spec = Parameters<typeof materialiseSlide>[0];

const THEMES = ["chalk", "night-lab"] as const;
const ABC = { A: "A", B: "B", C: "C" };

const diagram = (heading: string, body: string, values: Record<string, unknown>): Spec => ({
  kind: "diagram",
  heading,
  body,
  figure: { template: "triangle", values },
  factRefs: ["x1", "o2"],
});

const CASES: { name: string; heading: string; spec: Spec }[] = [
  {
    name: "trigonometry",
    heading: "Find the opposite side",
    spec: diagram(
      "Find the opposite side",
      "The hypotenuse is 10 cm and the angle at A is 35°. Use sin 35° to find x.",
      {
        vertices: ABC,
        rightAngleAt: "C",
        sides: { c: { value: 10, label: "10 cm" }, a: { label: "x" } },
        angles: { A: { value: 35, label: "35°" } },
        unknown: "a",
      },
    ),
  },
  {
    name: "cosine-rule",
    heading: "Two sides and the angle between",
    spec: diagram(
      "Two sides and the angle between",
      "Use the cosine rule to find x, the side opposite the 120° angle.",
      {
        vertices: ABC,
        sides: {
          a: { value: 5, label: "5 cm" },
          b: { value: 7, label: "7 cm" },
          c: { label: "x" },
        },
        angles: { C: { value: 120, label: "120°" } },
        unknown: "c",
      },
    ),
  },
  {
    name: "isosceles",
    heading: "An isosceles triangle",
    spec: diagram(
      "An isosceles triangle",
      "Two sides are equal, so the angles at A and B are equal. Find x, the angle at C.",
      {
        vertices: ABC,
        sides: {
          a: { value: 8, label: "8 cm" },
          b: { value: 8, label: "8 cm" },
          c: { value: 6, label: "6 cm" },
        },
        angles: { C: { label: "x" } },
        equalSides: ["a", "b"],
        equalAngles: ["A", "B"],
        unknown: "C",
      },
    ),
  },
  {
    name: "similar-pair",
    heading: "Similar triangles",
    spec: diagram(
      "Similar triangles",
      "Triangle PQR is an enlargement of ABC with scale factor 2. Find y.",
      {
        vertices: ABC,
        sides: {
          a: { value: 5, label: "5 cm" },
          b: { value: 6, label: "6 cm" },
          c: { value: 7, label: "7 cm" },
        },
        pair: {
          scale: 2,
          vertices: { A: "P", B: "Q", C: "R" },
          sides: { a: "10 cm", c: "y" },
        },
      },
    ),
  },
];

const META = {
  promptVersion: "generate-slide.v28",
  model: "fixture",
  at: "2026-09-27T12:00:00.000Z",
};

function lesson(themeId: string): Lesson {
  const base: Lesson = { ...newLesson("Triangles", themeId), id: `t221-${themeId}` };
  base.slides = CASES.map(({ spec }) => materialiseSlide(spec, themeId, META));
  return base;
}

test("captures triangle diagrams in the editor and on the stage, and the PowerPoint export", async ({
  signedInPage: { page },
}) => {
  await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
  const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
    headers: { origin: E2E_WEB_URL },
    data: { documents: THEMES.map((id) => ({ key: id, kind: "lesson", body: lesson(id) })) },
  });
  expect(res.ok(), `seed failed: ${res.status()} ${await res.text()}`).toBe(true);
  const { ids } = (await res.json()) as { ids: Record<string, string> };

  for (const themeId of THEMES) {
    const id = ids[themeId];
    for (const [i, { name, heading }] of CASES.entries()) {
      await page.goto(`/l/${id}`);
      const rows = page.getByRole("listbox", { name: "Slides" }).getByRole("option");
      await rows.nth(i).click();
      const figure = page.locator('[data-slide-frame] [data-element-type="group"]').first();
      await expect(figure).toBeVisible();
      await expect(page.locator("[data-slide-frame]").first()).toContainText(heading);
      const box = await figure.boundingBox();
      if (!box) throw new Error("no figure on the canvas");
      // Inside the group's frame, clear of its labels: one click selects the figure as a whole.
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.55);
      await expect(page.locator("[data-selection-frame]")).toBeVisible();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `/tmp/teach-221-${themeId}-editor-${name}.png` });

      await page.goto(`/l/${id}/present?slide=${i + 1}`);
      await expect(page.locator('[data-slide-mode="present"]')).toHaveCount(1);
      await expect(page.getByRole("status").first()).toContainText(`Slide ${i + 1} of`);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `/tmp/teach-221-${themeId}-stage-${name}.png` });
    }

    await page.goto(`/l/${id}`);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export" });
    await dialog.getByRole("tab", { name: "PowerPoint" }).click();
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Export PowerPoint" }).click();
    await (await download).saveAs(`/tmp/teach-221-${themeId}.pptx`);
  }
});
