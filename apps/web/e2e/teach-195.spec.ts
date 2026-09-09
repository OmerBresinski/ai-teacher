import type { Page } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "./a11y";
import { expect, type SeededPaths, test } from "./fixtures";

/*
 * TEACH-195: the answer marker outside the pupil's box (one correct option), the "Show answers"
 * view on the top bar, and "Print answer key" on the header toolbar. The seeded
 * `fraction-practice` sheet has no multiple-choice block, so each test adds one through the
 * gutter's "Add a block" dialog.
 */

const EDITOR = (paths: SeededPaths) => paths.worksheet("fraction-practice");
const blocks = (page: Page) => page.locator(".ws-column .ws-block");
const markers = (page: Page) => page.getByRole("button", { name: /^Answer: option/ });
const MOD = process.platform === "darwin" ? "Meta" : "Control";

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
    // The block is selected, so the markers are there; A is the seeded answer.
    await expect(markers(page)).toHaveCount(4);
    await expect(page.getByRole("button", { name: "Answer: option A" })).toHaveAttribute(
      "aria-pressed",
      "true",
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
    await expect(page.getByText("C. Option C")).toBeVisible();
    await expect(page.getByText("A. Option A")).toHaveCount(0);
  });

  test("rows 3 and 4: Show answers is a view — the model answer is editable, the pages do not move, print never sees it", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    await expect(blocks(page)).toHaveCount(9);
    const toggle = page.getByRole("button", { name: "Show answers" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".ws-column .ws-answer")).toHaveCount(0);
    const pagesBefore = await page.locator(".ws-column .ws-page").count();
    await toggle.hover();
    await expect(page.getByText("Show the answers on screen. Nothing prints.")).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    // The view changed nothing in the document: still Saved, same pages.
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    expect(await page.locator(".ws-column .ws-page").count()).toBe(pagesBefore);
    const answers = page.getByRole("textbox", { name: "Model answer" });
    await expect(answers.first()).toBeVisible();
    await expectNoSeriousA11yViolations(page, "/w/:id (Show answers on)");
    // A blank answer reads "No answer yet"; typing into it fills the document's answer.
    const field = answers.first();
    await field.click();
    await page.keyboard.press(`${MOD}+a`);
    await page.keyboard.press("Backspace");
    await expect(page.getByText("No answer yet").first()).toBeVisible();
    await page.keyboard.type("Three quarters", { delay: 20 });
    await expect(page.getByText("No answer yet")).toHaveCount(0);
    await page.waitForTimeout(700);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 5000 });
    // The shortcut turns the view off; the view is not saved, so a reload starts with it off.
    await page.keyboard.press(`${MOD}+Shift+K`);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".ws-column .ws-answer")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("button", { name: "Show answers" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await page.keyboard.press(`${MOD}+Shift+K`);
    await expect(page.getByRole("textbox", { name: "Model answer" }).first()).toHaveText(
      "Three quarters",
    );
    // `?` lists the shortcut.
    await page.locator(".ws-column").click({ position: { x: 4, y: 4 } });
    await page.keyboard.press("Shift+?");
    const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(help).toBeVisible();
    await expect(help.getByText("Show answers on / off")).toBeVisible();
    await page.keyboard.press("Escape");
    // The print route has no view to turn on: nothing of it in the printed markup.
    await page.goto(paths.worksheet("fraction-practice", "/print"));
    await expect(page.locator(".ws-print-root")).toHaveCSS("visibility", "visible");
    await expect(
      page.locator(
        ".ws-print-root :is(.ws-answer, .ws-opt-answer, .ws-gap-answer, .ws-match-answer)",
      ),
    ).toHaveCount(0);
    expect(await page.locator(".ws-print-root .ws-page").count()).toBe(pagesBefore);
  });
});
