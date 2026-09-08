/**
 * TEACH-153 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-153-screenshots.spec.ts`.
 *
 * Two runs: the editor shots come from the production build; the kit exhibit needs `E2E_KIT=1`
 * as well (the production build does not scan the kit's own utilities).
 */
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { addedElement, elementIds, expect, seededPaths, seedLibrary, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 }, seed: false });

const FIXTURE = fileURLToPath(new URL("./fixtures/photo-3000x2000.png", import.meta.url));
const shot = (name: string) => `/tmp/teach-153-${name}.png`;

async function centre(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} not on screen`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("captures crop mode, a trim with the thirds grid, straighten, flip and the committed result", async ({
  signedInPage: { page },
}) => {
  test.skip(process.env.E2E_KIT === "1", "editor shots come from the production build");
  const paths = seededPaths(await seedLibrary(page));
  await page.goto(paths.lesson("demo-water-cycle"));
  await expect(page.locator("[data-slide-frame]")).toBeVisible();
  await page.waitForTimeout(400);

  // A picture from the upload tab, then the image bar's Crop.
  const before = await elementIds(page);
  await page
    .getByRole("toolbar", { name: "Insert" })
    .getByRole("button", { name: "Image" })
    .click();
  const panel = page.getByRole("dialog", { name: /Add image|Replace image/ });
  await expect(panel.getByRole("tab", { name: "Upload", selected: true })).toBeVisible();
  await panel.locator('input[type="file"]').setInputFiles(FIXTURE);
  const image = addedElement(page, before);
  await expect(image.locator("img")).toHaveAttribute("src", /^data:image\//);
  await expect(panel).toBeHidden();
  const at = await centre(page, "[data-slide-frame] [data-element-type='image']");
  await page.mouse.click(at.x, at.y);
  await expect(page.getByRole("toolbar", { name: "Image" })).toBeVisible();
  await page.locator("[data-crop-button]").click();
  const layer = page.locator("[data-crop-layer]");
  await expect(layer).toBeVisible();
  const bar = page.getByRole("toolbar", { name: "Crop" });
  await expect(bar).toBeVisible();
  await page.mouse.move(1300, 900);
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot("crop-mode") });

  // Trim from the bottom-right handle and hold: the rule-of-thirds grid shows in flight.
  const se = await centre(page, '[data-handle="se"]');
  await page.mouse.move(se.x, se.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(se.x - i * 10, se.y - i * 6);
  await page.waitForTimeout(150);
  await page.screenshot({ path: shot("crop-trim-grid") });
  await page.mouse.up();

  // Straighten to 8° from the popover slider.
  await bar.getByRole("button", { name: /^Straighten/ }).click();
  const popover = page.getByRole("dialog", { name: "Straighten" });
  await expect(popover).toBeVisible();
  const slider = popover.getByRole("slider", { name: "Straighten" });
  await slider.focus();
  for (let i = 0; i < 8; i++) await slider.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", "8");
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot("crop-straighten") });
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(layer).toBeVisible();

  // A horizontal flip mirrors the picture and reverses the tilt.
  await bar.getByRole("button", { name: "Flip horizontal" }).click();
  await expect(bar.getByRole("button", { name: /^Straighten/ })).toHaveAccessibleName(/-8/);
  await page.mouse.move(1300, 900);
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot("crop-flip") });

  // Done commits the session; the navigator thumbnail follows.
  await page.locator("[data-crop-done]").click();
  await expect(layer).toBeHidden();
  await page.mouse.move(1300, 900);
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot("crop-committed") });
});

test("captures the crop bar exhibit in the kit", async ({ signedInPage: { page } }) => {
  test.skip(process.env.E2E_KIT !== "1", "the kit's utilities are scanned by the dev server only");
  await page.goto("/kit");
  await expect(page.getByRole("heading", { level: 1, name: "The kit" })).toBeVisible();
  const specimen = page
    .getByRole("heading", { name: "Crop bar" })
    .locator("xpath=ancestor::div[2]");
  await specimen.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await specimen.screenshot({ path: shot("kit-crop-bar") });
});
