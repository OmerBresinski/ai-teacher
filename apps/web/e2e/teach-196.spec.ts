import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/*
 * TEACH-196: the success criteria print in the self-assessment strip at the foot, under "Tick what
 * you can do now", and are typed into there. Nothing tick-able sits above the first task.
 */

const SHEET = "fraction-practice";
const header = (page: Page) => page.locator(".ws-column .ws-header");
const strip = (page: Page) => page.locator('.ws-column [data-block-id="__rag__"]');
const undoKey = process.platform === "darwin" ? "Meta+z" : "Control+z";

/** Select the header by its Name rule; the typed fields swallow their own pointer-down. */
async function selectHeader(page: Page) {
  await header(page).getByText("Name", { exact: true }).click();
  await expect(page.getByRole("switch", { name: "Self-assessment" })).toBeVisible();
}

async function openPrint(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator(".ws-print-root")).toHaveCSS("visibility", "visible");
  return page.locator(".ws-print-root");
}

test.describe("TEACH-196 success criteria in the self-assessment strip", () => {
  test("row 1: print has nothing tick-able above the first task; the foot has the label, the criteria, then the scale", async ({
    signedInPage: { page, paths },
  }) => {
    const root = await openPrint(page, paths.worksheet(SHEET, "/print"));
    await expect(root.locator(".ws-header .ws-criterion")).toHaveCount(0);
    const rag = root.locator(".ws-rag");
    await expect(rag).toHaveCount(1);
    await expect(rag.locator(".ws-rag-heading")).toHaveText("Tick what you can do now");
    expect(await rag.locator(".ws-criterion").count()).toBeGreaterThanOrEqual(2);
    await expect(rag.locator(".ws-rag-prompt")).toHaveText("How confident do you feel?");
    // Label, criteria, scale, in that order down the page.
    const tops = await rag
      .locator(".ws-rag-heading, .ws-criterion, .ws-rag-prompt")
      .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().top));
    for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeGreaterThan(tops[i - 1] ?? 0);
    // Below every task: the first box to tick sits under the last block on its page.
    const stripPage = root.locator(".ws-page", { has: rag });
    const lastBlock = stripPage.locator(".ws-block:not(.ws-rag-slot)").last();
    const blockBox = await lastBlock.boundingBox();
    const boxBox = await rag.locator(".ws-criterion-box").first().boundingBox();
    expect(boxBox?.y ?? 0).toBeGreaterThan((blockBox?.y ?? 0) + (blockBox?.height ?? 0) - 1);
  });

  test("row 2: self-assessment off prints no criteria and no strip", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(paths.worksheet(SHEET));
    await expect(strip(page)).toHaveCount(1);
    await selectHeader(page);
    const sw = page.getByRole("switch", { name: "Self-assessment" });
    await expect(sw).toBeChecked();
    await sw.click();
    await expect(strip(page)).toHaveCount(0);
    await expect(page.locator(".ws-column .ws-criterion")).toHaveCount(0);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    const root = await openPrint(page, paths.worksheet(SHEET, "/print"));
    await expect(root.locator(".ws-rag")).toHaveCount(0);
    await expect(root.locator(".ws-criterion")).toHaveCount(0);
  });

  test("row 3: switching on with no criteria opens the strip with one empty 'I can …' line focused", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(paths.worksheet(SHEET));
    await selectHeader(page);
    // Criterion sits beside the switch. Clear the seeded criteria, then switch off and on.
    const add = page.getByRole("button", { name: "Criterion" });
    await expect(add).toBeEnabled();
    const remove = strip(page).getByRole("button", { name: /^Remove criterion 1$/ });
    while ((await strip(page).locator(".ws-criterion").count()) > 0) {
      await strip(page).hover();
      await remove.click();
    }
    await expect(strip(page).locator(".ws-rag-heading")).toHaveCount(0);
    const sw = page.getByRole("switch", { name: "Self-assessment" });
    await sw.click();
    await expect(strip(page)).toHaveCount(0);
    await sw.click();
    const field = strip(page).getByRole("textbox", { name: "Success criterion 1" });
    await expect(field).toBeFocused();
    await expect(field).toHaveText("");
    await expect(strip(page).getByText("I can …")).toBeVisible();
    await expect(strip(page).locator(".ws-rag-heading")).toHaveText("Tick what you can do now");
    await page.keyboard.type("I can add fractions.", { delay: 20 });
    await expect(strip(page).getByText("I can …")).toHaveCount(0);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    // A blank line is pruned when focus leaves the strip.
    await add.click();
    await expect(strip(page).locator(".ws-criterion")).toHaveCount(2);
    await header(page).getByText("Name", { exact: true }).click();
    await expect(strip(page).locator(".ws-criterion")).toHaveCount(1);
  });

  test("row 4: a criterion is edited and removed in the strip, in place, undoable", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(paths.worksheet(SHEET));
    const field = strip(page).getByRole("textbox", { name: "Success criterion 1" });
    const original = (await field.textContent()) ?? "";
    expect(original.length).toBeGreaterThan(0);
    await field.click();
    await expect(field).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.type(" Yes.", { delay: 20 });
    await expect(field).toHaveText(`${original} Yes.`);
    await page.waitForTimeout(700);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await strip(page).hover();
    const before = await strip(page).locator(".ws-criterion").count();
    await strip(page).getByRole("button", { name: "Remove criterion 1" }).click();
    await expect(strip(page).locator(".ws-criterion")).toHaveCount(before - 1);
    await page.keyboard.press(undoKey);
    await expect(strip(page).locator(".ws-criterion")).toHaveCount(before);
    await expect(field).toHaveText(`${original} Yes.`);
    await page.keyboard.press(undoKey);
    await expect(field).toHaveText(original);
  });
});
