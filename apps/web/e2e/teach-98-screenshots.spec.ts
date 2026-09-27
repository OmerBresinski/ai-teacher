/**
 * TEACH-98 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-98-screenshots.spec.ts`.
 *
 * The fixture diagram spec (`teach-89-diagram-screenshots.spec.ts`) through `materialiseSlide` in
 * the default `figure-left` layout and in the new `figure-wide` one, on Chalk and on Night Lab for
 * a dark stage, each in the editor with the figure selected and on the presenter's stage. Every
 * one of the six themes also gets a slide of the Unicode labels `unicodeLabel` writes (U+20D7 over
 * a vector's letters above all, whose support differs between fonts) at the figure-label size,
 * bold, and at heading size, shown on the stage and exported to PowerPoint for a Quick Look render.
 */
import type { Lesson, TextElement, TextPreset } from "@tj/domain/documents";
import { materialiseSlide, newLesson } from "@tj/editor/starter";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 } });
test.setTimeout(300_000);

type Spec = Parameters<typeof materialiseSlide>[0];

const DIAGRAM_THEMES = ["chalk", "night-lab"] as const;
const ALL_THEMES = ["chalk", "playground", "reading-room", "exam-hall", "night-lab", "beacon"];

/** The fixture spec, as `packages/generation/src/fixtures/slides.json` has it. */
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
};

const META = {
  promptVersion: "generate-slide.v27",
  model: "fixture",
  at: "2026-09-27T12:00:00.000Z",
};

/** What `unicodeLabel` writes for `vec(AB)`, `x^2`, `10^-3`, `x_1`, `sqrt3`, `sqrt(x+1)`, … */
const VECTOR = "A⃗B⃗";
const LABELS = `${VECTOR}   x²   10⁻³   x₁   √3   √(x+1)   20π   40°   A′   B″`;

let n = 0;
const text = (
  preset: TextPreset,
  line: string,
  y: number,
  h: number,
  bold = false,
): TextElement => ({
  id: `t98-${++n}`,
  type: "text",
  x: 58,
  y,
  w: 844,
  h,
  doc: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: line, ...(bold ? { marks: [{ type: "bold" }] } : {}) }],
      },
    ],
  },
  style: { preset, autoHeight: true },
});

function lesson(themeId: string): Lesson {
  const base: Lesson = { ...newLesson("Unicode figure labels", themeId), id: `t98-${themeId}` };
  const labels = {
    id: `t98-labels-${themeId}`,
    kind: "blank" as const,
    elements: [
      text("caption", "FIGURE LABELS: SMALL, SMALL BOLD, HEADING", 60, 30),
      text("small", LABELS, 120, 40),
      text("small", LABELS, 180, 40, true),
      text("heading", LABELS, 250, 70),
      text("heading", `Vector ${VECTOR} and its reverse B⃗A⃗`, 360, 70),
    ],
  };
  const diagrams = (DIAGRAM_THEMES as readonly string[]).includes(themeId)
    ? [
        materialiseSlide(DIAGRAM, themeId, META, undefined, "figure-left"),
        materialiseSlide(DIAGRAM, themeId, META, undefined, "figure-wide"),
      ]
    : [];
  base.slides = [...diagrams, labels];
  return base;
}

test("captures figure-left and figure-wide diagrams, and Unicode labels on all six themes", async ({
  signedInPage: { page },
}) => {
  await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
  const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
    headers: { origin: E2E_WEB_URL },
    data: { documents: ALL_THEMES.map((id) => ({ key: id, kind: "lesson", body: lesson(id) })) },
  });
  expect(res.ok(), `seed failed: ${res.status()} ${await res.text()}`).toBe(true);
  const { ids } = (await res.json()) as { ids: Record<string, string> };

  const stage = async (id: string | undefined, slide: number, file: string) => {
    await page.goto(`/l/${id}/present?slide=${slide}`);
    await expect(page.locator('[data-slide-mode="present"]')).toHaveCount(1);
    await expect(page.getByRole("status").first()).toContainText(`Slide ${slide} of`);
    await page.waitForTimeout(600);
    await page.screenshot({ path: file });
  };

  for (const themeId of DIAGRAM_THEMES) {
    const id = ids[themeId];
    for (const [i, layout] of ["figure-left", "figure-wide"].entries()) {
      await page.goto(`/l/${id}`);
      const rows = page.getByRole("listbox", { name: "Slides" }).getByRole("option");
      await rows.nth(i).click();
      const figure = page.locator('[data-slide-frame] [data-element-type="group"]').first();
      await expect(figure).toBeVisible();
      await expect(page.locator("[data-slide-frame]").first()).toContainText("Find the hypotenuse");
      const box = await figure.boundingBox();
      if (!box) throw new Error("no figure on the canvas");
      // The group's own frame, not a label: one click selects the figure as a whole.
      await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.6);
      await expect(page.locator("[data-selection-frame]")).toBeVisible();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `/tmp/teach-98-${themeId}-editor-${layout}.png` });
      await stage(id, i + 1, `/tmp/teach-98-${themeId}-stage-${layout}.png`);
    }
  }

  for (const themeId of ALL_THEMES) {
    const id = ids[themeId];
    const slide = (DIAGRAM_THEMES as readonly string[]).includes(themeId) ? 3 : 1;
    await stage(id, slide, `/tmp/teach-98-${themeId}-labels.png`);

    await page.goto(`/l/${id}`);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export" });
    await dialog.getByRole("tab", { name: "PowerPoint" }).click();
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Export PowerPoint" }).click();
    await (await download).saveAs(`/tmp/teach-98-${themeId}.pptx`);
  }
});
