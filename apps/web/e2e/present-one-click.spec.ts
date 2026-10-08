import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/*
 * TEACH-153 (ruling 104): Present opens straight on the slides, one click, no cover. Criteria 1
 * and 2 with real clicks. The fullscreen request is recorded with whether the click's user
 * activation was still live when it was made, which is what decides whether a browser grants it.
 */

type FullscreenCall = { activation: boolean };

async function recordFullscreen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const calls: { activation: boolean }[] = [];
    (window as unknown as { __fullscreen: typeof calls }).__fullscreen = calls;
    const original = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = function (this: Element, options?: FullscreenOptions) {
      calls.push({ activation: navigator.userActivation?.isActive ?? false });
      return original.call(this, options);
    };
  });
}

const fullscreenCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __fullscreen: FullscreenCall[] }).__fullscreen ?? []);

const status = (page: Page) => page.getByRole("status").first();

async function expectNoCover(page: Page): Promise<void> {
  await expect(page.locator('[data-slide-mode="present"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Start presenting" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stay in this window" })).toHaveCount(0);
}

test.describe("TEACH-153: Present in one click", () => {
  test("criterion 1: from the editor on slide 5, one click presents slide 5 fullscreen", {
    tag: "@smoke",
  }, async ({ signedInPage: { page, paths } }) => {
    await recordFullscreen(page);
    await page.goto(paths.lesson("demo-water-cycle"));
    const rows = page.getByRole("listbox", { name: "Slides" }).getByRole("option");
    await rows.nth(4).click();
    await expect(rows.nth(4)).toHaveAttribute("aria-selected", "true");

    await page.getByRole("button", { name: "Present" }).click();

    await expect(page).toHaveURL(/present\?slide=5&from=edit$/);
    await expectNoCover(page);
    await expect(status(page)).toContainText("Slide 5 of");
    // Asked for inside the click, with the gesture still live, and granted.
    expect(await fullscreenCalls(page)).toEqual([{ activation: true }]);
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);

    // One Esc leaves fullscreen and the deck (ruling 104).
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(new RegExp(`${paths.lesson("demo-water-cycle")}$`));
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  });

  test("criterion 2: a library card's Present opens slide 1 in one click", async ({
    signedInPage: { page, paths },
  }) => {
    await recordFullscreen(page);
    await page.goto("/lessons");
    const card = page.locator("article").filter({ hasText: "The water cycle" }).first();
    await card.hover();
    await card.getByRole("button", { name: "Present" }).click();

    await expect(page).toHaveURL(new RegExp(`${paths.lesson("demo-water-cycle", "/present")}$`));
    await expectNoCover(page);
    await expect(status(page)).toContainText("Slide 1 of");
    expect(await fullscreenCalls(page)).toEqual([{ activation: true }]);
    // The shortcuts sheet is on the toolbar now the cover is gone (criterion 4).
    // Vite dev (the E2E_KIT ports) mounts the router devtools over this corner; builds do not.
    await page.addStyleTag({
      content: '[aria-label="Open TanStack Router Devtools"] { display: none !important; }',
    });
    await page.mouse.move(700, 500);
    await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  });

  test("criterion 3: with fullscreen refused, present runs in the window with no error", async ({
    signedInPage: { page, paths },
  }) => {
    await page.addInitScript(() => {
      Element.prototype.requestFullscreen = () => Promise.reject(new TypeError("refused"));
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(paths.lesson("demo-water-cycle"));
    await page.getByRole("button", { name: "Present" }).click();
    await expectNoCover(page);
    await expect(status(page)).toContainText("Slide 1 of");
    expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
    await page.keyboard.press("ArrowRight");
    await expect(status(page)).toContainText("Slide 2 of");
    expect(errors).toEqual([]);
  });
});
