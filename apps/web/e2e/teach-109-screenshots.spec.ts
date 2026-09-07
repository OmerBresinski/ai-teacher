/** TEACH-109 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-109-screenshots.spec.ts`. */
import { expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1280, height: 900 } });

test("captures the worksheet editor with a block selected and with the slash menu open", async ({
  signedInPage: { page, paths },
}) => {
  await page.goto(paths.worksheet("fraction-practice"));
  const blocks = page.locator(".ws-column .ws-block");
  await expect(blocks).toHaveCount(8);
  await page.waitForTimeout(400);
  await blocks.nth(2).click();
  await expect(page.getByRole("toolbar")).toBeVisible();
  await page.screenshot({ path: "/tmp/teach-109-editor.png" });

  // Leave edit mode: the gutter glyphs hide while a block is being typed into.
  await page.keyboard.press("Escape");
  await blocks.first().hover();
  await blocks.first().getByRole("button", { name: "Insert a block below" }).click();
  await expect(page.getByRole("listbox", { name: "Block types" })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "/tmp/teach-109-slash-menu.png" });
});
