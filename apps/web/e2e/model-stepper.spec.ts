/**
 * TEACH-247 part u (UX ruling 205): a drawn library model in the editor shows its whole, finished
 * drawing; a stepper on the model pages through the builds, and the model goes back to the full
 * view once it is neither hovered nor focused. Present still builds it step by step from step 1.
 *
 * The model is the real heart (`heart_circulation`, 4 builds after its opening frame), rendered
 * once by `renderLibraryModel` into `fixtures/heart-model.json`.
 *
 * With `TEACH_SCREENSHOTS=1 SHOT_DIR=<dir>` it also writes the PR screenshots (1440, light).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import type { Lesson, Slide } from "@tj/domain/documents";
import { demoWorkspace } from "@tj/editor/starter";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.use({ seed: false, viewport: { width: 1440, height: 900 } });

const heart = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "fixtures/heart-model.json"), "utf8"),
) as { src: string; builds: number; aspect: number; alt: string };
const SHOTS = process.env.TEACH_SCREENSHOTS === "1" ? (process.env.SHOT_DIR ?? "") : "";
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

const MODEL_ID = "heart-model";
/** The style `svgAtBuild` writes for any build before the last hides the last build's parts. */
const LAST_HIDDEN = `[data-s="${heart.builds}"]{opacity:0}`;
const svgOf = async (img: Locator) =>
  decodeURIComponent(((await img.getAttribute("src")) ?? "").split(",")[1] ?? "");

async function seedHeart(page: Page): Promise<string> {
  const water = demoWorkspace(new Date()).find((d) => d.key === "demo-water-cycle");
  if (!water || !("slides" in water.body)) throw new Error("fixture missing");
  const w = 800;
  const h = Math.round(w / heart.aspect);
  const slide: Slide = {
    id: "heart-slide",
    kind: "content",
    elements: [
      {
        id: MODEL_ID,
        type: "image",
        name: "Diagram",
        x: 80,
        y: Math.round((540 - h) / 2),
        w,
        h,
        src: heart.src,
        alt: heart.alt,
        fit: "contain",
        builds: heart.builds,
      },
    ],
  };
  const body: Lesson = {
    ...(water.body as Lesson),
    slides: [slide],
    plan: undefined,
    updatedAt: new Date().toISOString(),
  };
  const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
    headers: { origin: E2E_WEB_URL },
    data: { documents: [{ ...water, body }] },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { ids: Record<string, string> }).ids["demo-water-cycle"] as string;
}

test("the editor shows the whole model, the stepper pages its builds, Present still builds", async ({
  signedInPage: { page },
}) => {
  await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
  const id = await seedHeart(page);
  await page.goto(`/l/${id}`);

  const model = page.locator(`[data-slide-frame] [data-element-id="${MODEL_ID}"] img`);
  await expect(model).toBeVisible();
  // The finished drawing on the canvas and in the thumbnail: no build style.
  expect(await svgOf(model)).not.toContain(LAST_HIDDEN);
  const thumb = page
    .locator(`[data-slide-mode="thumb"] [data-element-id="${MODEL_ID}"] img`)
    .first();
  expect(await svgOf(thumb)).not.toContain(LAST_HIDDEN);
  const stepper = page.getByRole("toolbar", { name: "Model build stepper" });
  // Always present, faded at rest; never in the thumbnail.
  await expect(stepper).toBeVisible();
  await expect(stepper).not.toHaveAttribute("data-active", "");
  await expect(page.locator('[data-slide-mode="thumb"] [data-model-stepper]')).toHaveCount(0);
  await page.waitForTimeout(600);
  await shot(page, "editor-full");

  // Hover the model: the stepper opens on the full view, the last of 5 steps.
  const box = await model.boundingBox();
  if (!box) throw new Error("model not on screen");
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
  await expect(stepper).toHaveAttribute("data-active", "");
  await expect(stepper).toContainText(`Build ${heart.builds + 1} of ${heart.builds + 1}`);
  await expect(stepper.getByRole("button", { name: "Next build step" })).toBeDisabled();

  const prev = stepper.getByRole("button", { name: "Previous build step" });
  await prev.click();
  await prev.click();
  await expect(stepper).toContainText(`Build ${heart.builds - 1} of ${heart.builds + 1}`);
  await expect.poll(() => svgOf(model)).toContain(LAST_HIDDEN);
  // The thumbnail keeps the finished drawing while the canvas steps.
  expect(await svgOf(thumb)).not.toContain(LAST_HIDDEN);
  await page.waitForTimeout(1000);
  await shot(page, "editor-stepper-midway");
  await stepper.getByRole("button", { name: "Next build step" }).click();
  await stepper.getByRole("button", { name: "Next build step" }).click();
  await page.waitForTimeout(400);
  await shot(page, "editor-hover");
  await prev.click();
  await prev.click();

  // Keyboard: the arrows step inside the stepper, and the model does not move.
  await prev.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(stepper).toContainText(`Build ${heart.builds - 2} of ${heart.builds + 1}`);
  await page.keyboard.press("ArrowRight");
  await expect(stepper).toContainText(`Build ${heart.builds - 1} of ${heart.builds + 1}`);
  expect(await model.boundingBox()).toEqual(box);

  // Neither hovered nor focused: back to the whole model.
  await page.mouse.move(4, 450);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect.poll(() => svgOf(model)).not.toContain(LAST_HIDDEN);
  await expect(stepper).not.toHaveAttribute("data-active", "");

  // Present: unchanged, it opens the model on its first build and builds one per Next.
  await page.getByRole("button", { name: "Present" }).click();
  const presented = page.locator(`[data-slide-mode="present"] [data-element-id="${MODEL_ID}"] img`);
  await expect(presented).toBeVisible();
  await expect.poll(() => svgOf(presented)).toContain('[data-s="1"],');
  await page.waitForTimeout(800);
  await expect(page.locator("[data-model-stepper]")).toHaveCount(0);
  await shot(page, "present-step-1");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => svgOf(presented)).not.toContain('[data-s="1"],');
  await expect.poll(() => svgOf(presented)).toContain(LAST_HIDDEN);
});

test.describe("on a touch screen (iPad)", () => {
  test.use({ hasTouch: true });

  test("a tap shows the stepper, the build holds after a tap, a tap elsewhere drops it", async ({
    signedInPage: { page },
  }) => {
    await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
    const id = await seedHeart(page);
    await page.goto(`/l/${id}`);
    const model = page.locator(`[data-slide-frame] [data-element-id="${MODEL_ID}"] img`);
    await expect(model).toBeVisible();
    const box = await model.boundingBox();
    if (!box) throw new Error("model not on screen");
    await page.touchscreen.tap(box.x + box.width * 0.3, box.y + box.height * 0.4);
    const stepper = page.getByRole("toolbar", { name: "Model build stepper" });
    await expect(stepper).toBeVisible();
    await stepper.getByRole("button", { name: "Previous build step" }).tap();
    await expect(stepper).toContainText(`Build ${heart.builds} of ${heart.builds + 1}`);
    // Safari does not focus a tapped button: the build must hold without focus or hover.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.waitForTimeout(300);
    await expect(stepper).toContainText(`Build ${heart.builds} of ${heart.builds + 1}`);
    expect(await svgOf(model)).toContain(LAST_HIDDEN);
    // A tap on the empty grey margin round the slide clears the selection: the whole model again.
    await page.touchscreen.tap(box.x + box.width + 120, box.y + 10);
    await expect.poll(() => svgOf(model)).not.toContain(LAST_HIDDEN);
  });
});
