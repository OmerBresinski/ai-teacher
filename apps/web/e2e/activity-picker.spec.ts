import type { Page } from "@playwright/test";
import { expect, type SeededPaths, test } from "./fixtures";

/* TEACH-185: one activity picker with live previews; staged reveal in present. */

const EDITOR = (paths: SeededPaths) => paths.lesson("demo-water-cycle");
const status = (page: Page) => page.getByRole("status").first();

async function openActivities(page: Page) {
  await page
    .getByRole("toolbar", { name: "Insert" })
    .getByRole("button", { name: "Activities" })
    .click();
  const menu = page.getByRole("menu", { name: "Activities" });
  await expect(menu).toBeVisible();
  return menu;
}

/** The answer cards on the present stage that are dimmed (a wrong option once revealed). */
async function dimmedCards(page: Page): Promise<number> {
  return page
    .locator("[data-slide-mode='present'] [data-element-type='option'] > div > div")
    .evaluateAll(
      (nodes) => nodes.filter((n) => (n as HTMLElement).style.opacity === "0.45").length,
    );
}

test.describe("activity picker", () => {
  test("row 1: rail Activities opens the grid grouped Check, Apply, Structure with previews", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    await expect(page.locator("[data-slide-frame]")).toBeVisible();
    const menu = await openActivities(page);
    await expect(page.getByRole("tab", { name: "Activities", selected: true })).toBeVisible();
    const groups = await menu
      .getByRole("group")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")));
    expect(groups).toEqual(["Check", "Apply", "Structure"]);
    await expect(menu.getByRole("menuitem")).toHaveCount(12);
    for (const name of ["True or false", "Which are true", "Matching", "Do now", "Timer"]) {
      await expect(
        menu.getByRole("menuitem", { name, exact: true }).locator("[data-slide-mode='thumb']"),
      ).toBeVisible();
    }
    await expect(
      menu.getByRole("menuitem", { name: "Multiple choice", exact: true }),
    ).toHaveAttribute("aria-description", /Pupils see four options/);
    // Row 7: every card is reachable from the keyboard; Escape closes.
    const first = menu.getByRole("menuitem").first();
    await first.focus();
    for (let i = 0; i < 11; i++) await page.keyboard.press("ArrowRight");
    await expect(menu.getByRole("menuitem", { name: "Timer", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  test("rows 2 and 3: Matching inserts the previewed slide after the active one", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    await expect(page.locator("[data-slide-frame]")).toBeVisible();
    const rows = page.getByRole("option");
    const before = await rows.count();
    const menu = await openActivities(page);
    await menu.getByRole("menuitem", { name: "Matching", exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(rows).toHaveCount(before + 1);
    const frame = page.locator("[data-slide-frame]");
    await expect(frame).toContainText("Match each term to its definition.");
    // Derived from the lesson's facts when it has them (row 2), the fixture otherwise (row 3):
    // either way at least three terms and three definitions sit under the stem.
    const texts = await frame
      .locator("[data-element-type='text']")
      .evaluateAll((nodes) => nodes.map((n) => n.textContent?.trim() ?? ""));
    expect(texts.length).toBeGreaterThanOrEqual(7);
    expect(texts.slice(1).every((t) => t.length > 0)).toBe(true);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test("rows 4 and 5: True or false inserts its slide; the Challenge chip adds an Explain why line", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    await expect(page.locator("[data-slide-frame]")).toBeVisible();
    const frame = page.locator("[data-slide-frame]");
    let menu = await openActivities(page);
    await menu.getByRole("menuitem", { name: "True or false", exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(frame).toContainText("Write a statement that is clearly true or clearly false.");
    await expect(frame.locator("[data-element-type='option']")).toHaveCount(2);
    menu = await openActivities(page);
    const challenge = page.getByRole("radio", { name: "Challenge" });
    await challenge.click();
    await expect(challenge).toBeChecked();
    await menu.getByRole("menuitem", { name: "Multiple choice", exact: true }).click();
    await expect(frame).toContainText("Explain why.");
    await expect(frame.locator("[data-element-type='option']")).toHaveCount(4);
  });

  test("row 6: present, four-option multiple choice, Right x3 dims the wrong options, then the right one fills", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    await expect(page.locator("[data-slide-frame]")).toBeVisible();
    const menu = await openActivities(page);
    await menu.getByRole("menuitem", { name: "Multiple choice", exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 5_000 });

    await page.goto(`${paths.lesson("demo-water-cycle", "/present")}?slide=2`);
    await page.getByRole("button", { name: "Stay in this window" }).click();
    await expect(status(page)).toContainText("Slide 2 of");
    await expect(status(page)).toContainText("step 1 of 5");
    const filled = page.getByRole("img", { name: "Correct answer" });
    expect(await dimmedCards(page)).toBe(0);
    await page.keyboard.press("ArrowRight");
    await expect(status(page)).toContainText("step 2 of 5");
    expect(await dimmedCards(page)).toBe(1);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(status(page)).toContainText("step 4 of 5");
    expect(await dimmedCards(page)).toBe(3);
    await expect(filled).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Answer/ })).toBeVisible();
    await page.keyboard.press("Space");
    await expect(status(page)).toContainText("answer shown");
    await expect(filled).toHaveCount(1);
    expect(await dimmedCards(page)).toBe(3);
  });
});
