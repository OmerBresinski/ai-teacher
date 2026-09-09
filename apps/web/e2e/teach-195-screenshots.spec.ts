/** TEACH-195 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-195-screenshots.spec.ts`. */
import { expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 } });

test("captures a selected multiple-choice block with its marker, and the sheet with Show answers on", async ({
  signedInPage: { page, paths },
}) => {
  await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
  await page.goto(paths.worksheet("fraction-practice"));
  const blocks = page.locator(".ws-column .ws-block");
  await expect(blocks).toHaveCount(9);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  // A multiple-choice block under the first block, selected, with the marker beside option A.
  const first = blocks.first();
  await first.hover();
  await first.getByRole("button", { name: "Insert a block below" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a block" });
  await dialog.getByRole("tab", { name: "Blocks" }).click();
  await dialog.getByRole("button", { name: /^Multiple choice/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: /^Answer: option/ })).toHaveCount(4);
  await page.getByRole("button", { name: "Answer: option C" }).click();
  await page.mouse.move(4, 400);
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/teach-195-marker.png" });

  // Show answers on: the model answers under the stems, every marker showing.
  await page.locator(".ws-column").click({ position: { x: 4, y: 4 } });
  await page.getByRole("button", { name: "Show answers" }).click();
  await expect(page.getByRole("textbox", { name: "Model answer" }).first()).toBeVisible();
  await page.mouse.move(4, 400);
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/teach-195-show-answers.png" });
});
