/**
 * Screenshot capture for the TEACH-103 PR: our editor next to TeachDeck's (`next dev` on :3999)
 * on the same lesson, same viewport. Not a spec — run with
 * `bun --bun playwright test e2e/teach-103-screenshots.spec.ts` with `TEACH_SCREENSHOTS=1`.
 */
import { expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");

test.use({ viewport: { width: 1440, height: 900 } });

test("captures the editor at rest, with a selection and guides, and the navigator", async ({
  signedInPage: { page },
}) => {
  await page.goto("/l/demo-water-cycle");
  await expect(page.getByRole("heading", { level: 1, name: "The water cycle" })).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/tmp/teach-103-editor.png" });

  const title = page
    .locator("[data-slide-frame] [data-element-id]")
    .filter({ hasText: "The water cycle" })
    .first();
  const box = await title.boundingBox();
  if (!box) throw new Error("no title");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 3, y + 2);
  await page.mouse.move(x + 4, y + 30);
  await page.waitForTimeout(100);
  await page.screenshot({ path: "/tmp/teach-103-editor-drag-guides.png" });
  await page.mouse.up();
  await page.waitForTimeout(100);
  await page.screenshot({ path: "/tmp/teach-103-editor-selected.png" });

  await page.locator("[data-navigator]").screenshot({ path: "/tmp/teach-103-navigator.png" });
});

test("captures TeachDeck's editor on the same lesson for the side-by-side", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const td = await context.newPage();
  const res = await td.goto("http://localhost:3999/v2/l/demo-water-cycle", { timeout: 60_000 });
  if (!res?.ok()) test.skip(true, "TeachDeck dev server not running on :3999");
  await td.waitForTimeout(2_500);
  await td.screenshot({ path: "/tmp/teachdeck-editor.png" });
  await context.close();
});
