/** TEACH-194 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-194-screenshots.spec.ts`. */
import type { Page } from "@playwright/test";
import { expect, type SeededPaths, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 } });

const EDITOR = (paths: SeededPaths) => paths.worksheet("fraction-practice");
const blocks = (page: Page) => page.locator(".ws-column .ws-block");

test("captures the Blocks tab, a matching block with its inserted instruction, and the inline hint", async ({
  signedInPage: { page, paths },
}) => {
  await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
  await page.goto(EDITOR(paths));
  await expect(blocks(page)).toHaveCount(9);

  const heading = blocks(page).nth(1);
  await heading.hover();
  await heading.getByRole("button", { name: "Insert a block below" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a block" });
  await dialog.getByRole("tab", { name: "Blocks" }).click();
  await expect(dialog.getByRole("button", { name: /^Sorting table/ })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-194-blocks-tab.png" });

  await dialog.getByRole("button", { name: /^Matching/ }).click();
  await expect(dialog).toBeHidden();
  await expect(blocks(page)).toHaveCount(11);
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-194-matching-instruction.png" });

  const matching = blocks(page).nth(3);
  await matching.getByRole("textbox", { name: "Match A" }).fill("Rodent");
  await matching.getByRole("textbox", { name: "Match B" }).fill("Rodent");
  await expect(matching.locator(".ws-warning")).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-194-inline-hint.png" });
});
