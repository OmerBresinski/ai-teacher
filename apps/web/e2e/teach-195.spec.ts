import type { Page } from "@playwright/test";
import { expect, type SeededPaths, test } from "./fixtures";

/*
 * TEACH-195: the answer marker outside the pupil's box makes one option the answer. The seeded
 * `fraction-practice` sheet has no multiple-choice block, so the test adds one through the gutter's
 * "Add a block" dialog.
 */

const EDITOR = (paths: SeededPaths) => paths.worksheet("fraction-practice");
/** Content blocks only: the self-assessment strip is a flow item too, pinned to the foot (TEACH-196). */
const blocks = (page: Page) => page.locator(".ws-column .ws-block:not(.ws-rag-slot)");
const markers = (page: Page) => page.getByRole("button", { name: /^Answer: option/ });

/** Insert a multiple-choice block under the first block; it comes back selected. */
async function addMultipleChoice(page: Page) {
  await expect(blocks(page)).toHaveCount(9);
  const first = blocks(page).first();
  await first.hover();
  await first.getByRole("button", { name: "Insert a block below" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a block" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "Blocks" }).click();
  await dialog.getByRole("button", { name: /^Multiple choice/ }).click();
  await expect(dialog).toBeHidden();
  await expect(blocks(page)).toHaveCount(10);
  const mc = blocks(page).filter({ has: page.locator(".ws-options") });
  await expect(mc).toHaveCount(1);
  return mc;
}

test.describe("answers on the sheet (TEACH-195)", () => {
  test("rows 1 and 2: the pupil's boxes are empty; the marker makes one option the answer and Tab reaches it", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    const mc = await addMultipleChoice(page);
    // Four printed squares, none of them a button, none ticked.
    await expect(mc.locator(".ws-opt-box")).toHaveCount(4);
    await expect(mc.locator("button.ws-opt-box, .ws-opt-check-on")).toHaveCount(0);
    // The block is selected, so the markers are there; a new block starts with no answer.
    await expect(markers(page)).toHaveCount(4);
    await expect(page.getByRole("button", { name: /^Answer: option/, pressed: true })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "Answer: option C" }).click();
    await expect(page.getByRole("button", { name: "Answer: option C" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: "Answer: option A" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    // Tab from the option's text lands on its marker.
    await mc.getByRole("textbox", { name: "Option B" }).click();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Answer: option B" })).toBeFocused();
    // Deselecting hides the markers again.
    await page.keyboard.press("Escape");
    await page.locator(".ws-column").click({ position: { x: 4, y: 4 } });
    await expect(markers(page)).toHaveCount(0);
    // The key prints only C: turn the printed key on and read it on the print route.
    await page.locator(".ws-column .ws-header").click({ position: { x: 4, y: 4 } });
    await page.getByRole("switch", { name: "Print answer key" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 5000 });
    await page.goto(paths.worksheet("fraction-practice", "/print"));
    await expect(page.locator(".ws-print-root")).toHaveCSS("visibility", "visible");
    await expect(page.getByRole("heading", { level: 2, name: "Answer key" })).toBeVisible();
    const keyLines = page.locator(".ws-print-root .ws-page .ws-key-line");
    await expect(keyLines.filter({ hasText: "C. Option C" })).toHaveCount(1);
    await expect(keyLines.filter({ hasText: "A. Option A" })).toHaveCount(0);
  });
});
