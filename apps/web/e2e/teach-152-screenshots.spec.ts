/** TEACH-152 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-152-screenshots.spec.ts`. */
import { addedElement, elementIds, expect, seededPaths, seedLibrary, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 }, seed: false });

const shot = (name: string) => `/tmp/teach-152-${name}.png`;

test("captures the element and ground context menus and a rectangle inserted beneath the title", async ({
  signedInPage: { page },
}) => {
  const paths = seededPaths(await seedLibrary(page));
  await page.goto(paths.lesson("demo-water-cycle"));
  const frame = page.locator("[data-slide-frame]");
  await expect(frame).toBeVisible();
  await page.waitForTimeout(400);
  const fb = await frame.boundingBox();
  if (!fb) throw new Error("no frame");

  // Right-click on the title text: the element menu.
  const title = frame.locator('[data-element-type="text"]').first();
  const tb = await title.boundingBox();
  if (!tb) throw new Error("no title");
  await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2, { button: "right" });
  await expect(page.getByRole("menu", { name: "Element" })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot("context-menu-element") });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // Right-click on empty slide ground: the shorter slide menu.
  await page.mouse.click(fb.x + fb.width - 80, fb.y + fb.height - 80, { button: "right" });
  await expect(page.getByRole("menu", { name: "Slide" })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot("context-menu-ground") });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // A fresh rectangle enters the draw order beneath the slide's text, so the title reads over it.
  const before = await elementIds(page);
  await page
    .getByRole("toolbar", { name: "Insert" })
    .getByRole("button", { name: "Shape" })
    .click();
  await page.getByRole("menuitem", { name: "Rectangle" }).click();
  const rect = addedElement(page, before);
  await expect(rect).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Shape" })).toBeVisible();
  // Move focus off the rail button (its tooltip follows focus) and park the pointer on the margin.
  const rb = await rect.boundingBox();
  if (!rb) throw new Error("no rectangle");
  await page.mouse.click(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.mouse.move(1300, 900);
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot("shape-under-title") });
});
