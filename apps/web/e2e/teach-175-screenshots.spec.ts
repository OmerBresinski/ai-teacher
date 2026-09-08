/** TEACH-175 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-175-screenshots.spec.ts`. */
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { expect, seededPaths, seedLibrary, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 }, seed: false });

const FIXTURE = fileURLToPath(new URL("./fixtures/photo-3000x2000.png", import.meta.url));
const shot = (name: string) => `/tmp/teach-175-${name}.png`;

/** The `data-element-id`s under the slide frame, to tell a just-inserted element from the rest. */
const elementIds = (page: Page) =>
  page
    .locator("[data-slide-frame] [data-element-id]")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-element-id") ?? ""));

/** The element that was not in `before`, pinned to its id so later inserts do not widen it. */
async function addedElement(page: Page, before: string[]) {
  const fresh = page.locator(
    `[data-slide-frame] [data-element-id]${before.map((id) => `:not([data-element-id="${id}"])`).join("")}`,
  );
  await expect(fresh).toHaveCount(1);
  const id = await fresh.getAttribute("data-element-id");
  return page.locator(`[data-slide-frame] [data-element-id="${id}"]`);
}

async function centre(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Move an element by `dx` from its centre, the way a hand does it. */
async function dragBy(page: Page, el: Locator, dx: number) {
  const from = await centre(el);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + (dx * i) / 8, from.y);
  await page.mouse.up();
}

async function shiftClick(page: Page, el: Locator) {
  const at = await centre(el);
  await page.keyboard.down("Shift");
  await page.mouse.click(at.x, at.y);
  await page.keyboard.up("Shift");
}

async function insertRectangle(page: Page) {
  const before = await elementIds(page);
  await page
    .getByRole("toolbar", { name: "Insert" })
    .getByRole("button", { name: "Shape" })
    .click();
  await page.getByRole("menuitem", { name: "Rectangle" }).click();
  const rect = await addedElement(page, before);
  await expect(rect).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Shape" })).toBeVisible();
  return rect;
}

test("captures the shared bar with a mixed swatch, a group's Ungroup, and rect + image controls", async ({
  signedInPage: { page },
}) => {
  const paths = seededPaths(await seedLibrary(page));
  await page.goto(paths.lesson("demo-water-cycle"));
  await expect(page.locator("[data-slide-frame]")).toBeVisible();
  await page.waitForTimeout(400);

  // Rectangle A to the left with a different fill; rectangle B to the right on the default.
  const a = await insertRectangle(page);
  await dragBy(page, a, -300);
  const fillTrigger = page
    .getByRole("toolbar", { name: "Shape" })
    .getByRole("button", { name: "Fill" });
  const fillOf = () => fillTrigger.locator("[title]").first().getAttribute("title");
  const original = await fillOf();
  await fillTrigger.click();
  const fill = page.getByRole("dialog", { name: "Fill" });
  await expect(fill).toBeVisible();
  // The theme palette: pick the first swatch that is not the current fill.
  const other = fill.locator(`button[aria-label]:not([aria-label="${original}" i])`).first();
  await other.click();
  await expect.poll(fillOf).not.toBe(original);
  await page.keyboard.press("Escape");
  const b = await insertRectangle(page);
  await dragBy(page, b, 300);

  // Both selected: one Selection bar, Fill reads as mixed.
  await shiftClick(page, a);
  const selection = page.getByRole("toolbar", { name: "Selection" });
  await expect(selection).toBeVisible();
  await expect(selection.getByRole("button", { name: "Fill, mixed" })).toBeVisible();
  await page.mouse.move(1300, 900);
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot("multi-bar-mixed") });

  // Group them: the group's bar carries Ungroup.
  await selection.getByRole("button", { name: "Group" }).click();
  const ungroup = page.getByRole("button", { name: "Ungroup" });
  await expect(ungroup).toBeVisible();
  await page.mouse.move(1300, 900);
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot("group-bar-ungroup") });
  await ungroup.click();
  await page.keyboard.press("Escape");

  // A picture plus rectangle A: only Corners and Opacity are shared.
  const before = await elementIds(page);
  await page
    .getByRole("toolbar", { name: "Insert" })
    .getByRole("button", { name: "Image" })
    .click();
  const panel = page.getByRole("dialog", { name: /Add image|Replace image/ });
  await expect(panel.getByRole("tab", { name: "Upload", selected: true })).toBeVisible();
  await panel.locator('input[type="file"]').setInputFiles(FIXTURE);
  const image = await addedElement(page, before);
  await expect(image.locator("img")).toHaveAttribute("src", /^data:image\//);
  await expect(panel).toBeHidden();
  const at = await centre(image);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByRole("toolbar", { name: "Image" })).toBeVisible();
  await shiftClick(page, a);
  await expect(selection).toBeVisible();
  await expect(selection.getByRole("button", { name: /^Corners/ })).toBeVisible();
  await expect(selection.getByRole("button", { name: "Fill" })).toHaveCount(0);
  await page.mouse.move(1300, 900);
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot("multi-bar-corners") });
});
