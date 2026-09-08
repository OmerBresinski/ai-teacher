/** TEACH-151 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-151-screenshots.spec.ts`. */
import type { Locator, Page } from "@playwright/test";
import { expect, seededPaths, seedLibrary, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 }, seed: false });

const shot = (name: string) => `/tmp/teach-151-${name}.png`;

async function centre(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Press at `from`, move `steps` times towards `from + (dx, dy)` and stay pressed. */
async function dragHold(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  const steps = 8;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
  }
  await page.waitForTimeout(150);
}

test("captures the shape bar, live resize, its menus and popovers, the marquee and a Shift side drag", async ({
  signedInPage: { page },
}) => {
  const paths = seededPaths(await seedLibrary(page));
  await page.goto(paths.lesson("demo-water-cycle"));
  const frame = page.locator("[data-slide-frame]");
  await expect(frame).toBeVisible();
  await page.waitForTimeout(400);

  await page
    .getByRole("toolbar", { name: "Insert" })
    .getByRole("button", { name: "Shape" })
    .click();
  await page.getByRole("menuitem", { name: "Rectangle" }).click();
  const bar = page.getByRole("toolbar", { name: "Shape" });
  await expect(bar).toBeVisible();
  await expect(page.locator("[data-rotate-grip]")).toBeVisible();
  // Move focus off the rail button (its tooltip follows focus) and park the pointer on the margin.
  const rect = page.locator('[data-slide-frame] [data-element-type="shape"]').last();
  const at = await centre(rect);
  await page.mouse.click(at.x, at.y);
  await page.mouse.move(1300, 900);
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot("shape-bar") });

  // Mid corner-drag: the rectangle redraws at the live size under the pointer.
  await dragHold(page, await centre(page.locator('[data-handle="se"]')), 90, 50);
  await page.screenshot({ path: shot("resize-mid-drag") });
  await page.mouse.up();

  await bar.getByRole("button", { name: /^Border width/ }).click();
  await expect(page.getByRole("menu", { name: "Border width" })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot("border-width-menu") });
  await page.keyboard.press("Escape");

  await bar.getByRole("button", { name: "Opacity" }).click();
  await expect(page.getByRole("dialog", { name: "Opacity" })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot("opacity-popover") });
  await page.keyboard.press("Escape");

  await bar.getByRole("button", { name: "Label" }).click();
  await expect(page.getByRole("dialog", { name: "Label" })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot("label-popover") });
  await page.keyboard.press("Escape");

  // A marquee from the margin round the slide, held over the title: candidates outline live.
  await page.keyboard.press("Escape");
  const fb = await frame.boundingBox();
  if (!fb) throw new Error("no frame");
  await dragHold(page, { x: fb.x - 24, y: fb.y + 60 }, fb.width * 0.7, fb.height * 0.5);
  await expect(page.locator("[data-marquee]")).toBeVisible();
  await expect(page.locator("[data-marquee-candidate]").first()).toBeVisible();
  await page.screenshot({ path: shot("marquee-preview") });
  await page.mouse.up();
  await page.keyboard.press("Escape");

  // Shift on a side handle: the width follows the pointer and the height scales with it.
  const again = await centre(rect);
  await page.mouse.click(again.x, again.y);
  await expect(bar).toBeVisible();
  await page.keyboard.down("Shift");
  await dragHold(page, await centre(page.locator('[data-handle="e"]')), 120, 0);
  await page.screenshot({ path: shot("side-shift-resize") });
  await page.mouse.up();
  await page.keyboard.up("Shift");
});
