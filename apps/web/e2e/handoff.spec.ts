/**
 * TeachDeck's `docs/MONOREPO-HANDOFF.md` "Acceptance after migration", the editor / present /
 * worksheet / export lines (TEACH-113; the library-shell lines are `library.spec.ts`, TEACH-94):
 *
 * > Navigate overlays/tabs by keyboard. Check focus restoration, nested Escape handling and
 * > fullscreen portals.
 * > Edit text/shapes, undo/redo, reorder slides, present with fullscreen refused, and open/close
 * > overview.
 * > Edit/reload a worksheet; inspect PDF, PPTX, PNG, JSON and DOCX output where supported.
 * > Check light chrome, dark stage controls, narrow layouts and the recorded contrast issue.
 *
 * One full pointer flow through the editor, one keyboard-only flow, and the narrow-viewport smoke
 * for the editor and the worksheet. The feature specs (`editor*`, `present`, `export*`,
 * `worksheet-editor`, `a11y`) hold the row-by-row detail; these are the end-to-end walks.
 */
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "./a11y";
import { addedElement, elementIds, expect, type SeededPaths, test } from "./fixtures";

const EDITOR = (paths: SeededPaths) => paths.lesson("demo-water-cycle");
const FIXTURE = fileURLToPath(new URL("./fixtures/photo-3000x2000.png", import.meta.url));

const frame = (page: Page) => page.locator("[data-slide-frame]");
const stageElements = (page: Page) => page.locator("[data-slide-frame] [data-element-id]");
const rows = (page: Page) => page.getByRole("listbox", { name: "Slides" }).getByRole("option");
const proseMirror = (page: Page) => page.locator("[data-slide-frame] .ProseMirror");
const undoButton = (page: Page) => page.getByRole("button", { name: "Undo" });
const canvas = (page: Page) => page.getByRole("group", { name: "Slide canvas" });

async function centre(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

/** Playwright `mouse.down / move×steps / up`, the way a hand does it. */
async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + (dx * i) / 8, from.y + (dy * i) / 8);
  await page.mouse.up();
}

const leftOf = (el: Locator) =>
  el.evaluate((n) => Number.parseFloat((n as HTMLElement).style.left));
const widthOf = (el: Locator) =>
  el.evaluate((n) => Number.parseFloat((n as HTMLElement).style.width));

test.describe("handoff: the editor end to end", () => {
  test("open → edit text → drag → resize → undo → theme → layout → image → present → back", async ({
    signedInPage: { page, paths },
  }) => {
    test.setTimeout(60_000);
    // Open from the library, as a teacher does.
    await page.goto("/lessons");
    await page.getByRole("link", { name: "Open The water cycle" }).click();
    await expect(page).toHaveURL(new RegExp(`${EDITOR(paths)}$`));
    await expect(rows(page)).toHaveCount(7);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    // Edit text: double-click the title, type, Escape commits.
    const title = stageElements(page).filter({ hasText: "The water cycle" }).first();
    const at = await centre(title);
    await page.mouse.dblclick(at.x, at.y);
    await expect(proseMirror(page)).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.type(" today");
    await page.keyboard.press("Escape");
    await expect(proseMirror(page)).toHaveCount(0);
    await expect(title).toContainText("The water cycle today");

    // Drag it 40px right (⌘ holds the snap off), then resize the selection from its corner.
    const scale = (await frame(page).boundingBox())?.width ?? 960;
    const before = await leftOf(title);
    await page.keyboard.down("Meta");
    await drag(page, await centre(title), 40, 0);
    await page.keyboard.up("Meta");
    await expect.poll(() => leftOf(title)).toBeCloseTo(before + 40 / (scale / 960), 0);
    const width = await widthOf(title);
    await page.keyboard.down("Meta");
    await drag(page, await centre(page.locator('[data-handle="e"]')), 40, 0);
    await page.keyboard.up("Meta");
    await expect.poll(() => widthOf(title)).toBeGreaterThan(width);

    // Undo: the resize, then the drag, then the typing — three steps, in that order.
    await undoButton(page).click();
    await expect.poll(() => widthOf(title)).toBeCloseTo(width, 0);
    await undoButton(page).click();
    await expect.poll(() => leftOf(title)).toBeCloseTo(before, 0);
    await undoButton(page).click();
    await expect(title).not.toContainText("today");
    await expect(undoButton(page)).toBeDisabled();
    // Redo brings the typing back.
    await page.getByRole("button", { name: "Redo" }).click();
    await expect(title).toContainText("The water cycle today");

    // Theme: Playground, and the canvas follows.
    const root = page.locator("[data-slide-frame] [data-slide-root]");
    const paint = () => root.evaluate((n) => getComputedStyle(n).backgroundColor);
    const paintBefore = await paint();
    await page.getByRole("button", { name: "Theme" }).click();
    const theme = page.getByRole("dialog", { name: "Theme" });
    await theme.getByRole("radio", { name: "Playground" }).click();
    await theme.getByRole("button", { name: "Done" }).click();
    await expect(theme).toHaveCount(0);
    await expect.poll(paint).not.toBe(paintBefore);

    // Layout: slide 2 becomes a true-or-false slide after the confirm; the navigator says so.
    await rows(page).nth(1).click();
    await expect(rows(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await page
      .getByRole("toolbar", { name: "Slide" })
      .getByRole("button", { name: /Slide layout/ })
      .click();
    await page.getByRole("menuitemradio", { name: "True or false" }).click();
    await page.getByRole("button", { name: "Convert" }).click();
    await expect(rows(page).nth(1)).toHaveAttribute("aria-label", "Slide 2, True or false");

    // Image: `i` on the canvas opens the panel; an upload lands a centred picture.
    const ids = await elementIds(page);
    await canvas(page).click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("i");
    const panel = page.getByRole("dialog", { name: "Add image" });
    await expect(panel).toBeVisible();
    await panel.locator('input[type="file"]').setInputFiles(FIXTURE);
    await expect(panel).toHaveCount(0);
    await expect(addedElement(page, ids).locator("img")).toHaveAttribute("src", /^data:image\//);
    await expect(page.getByRole("toolbar", { name: "Image" })).toBeVisible();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 5_000 });

    // Present with fullscreen refused ("Stay in this window"), open and close the overview, back.
    await page.getByRole("button", { name: "Present" }).click();
    await expect(page).toHaveURL(/present\?from=edit$/);
    await page.getByRole("button", { name: "Stay in this window" }).click();
    await expect(page.getByRole("status").first()).toContainText("Slide 1 of 7");
    await page.keyboard.press("o");
    const overview = page.getByRole("dialog");
    await expect(overview).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(overview).toBeHidden();
    await expect(page).toHaveURL(/present/);
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(new RegExp(`${EDITOR(paths)}$`));
    await expect(rows(page)).toHaveCount(7);
    // Everything survived the round trip: the title edit, the theme, the layout, the picture.
    await expect(stageElements(page).filter({ hasText: "The water cycle today" })).toHaveCount(1);
    await expect(rows(page).nth(1)).toHaveAttribute("aria-label", "Slide 2, True or false");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  });

  test("keyboard only: insert, nudge, undo, help (focus restored, nested Escape), slides from the rail", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(EDITOR(paths));
    await expect(rows(page)).toHaveCount(7);
    const count = await stageElements(page).count();

    // The canvas has focus: `r` inserts a rectangle, selected.
    await canvas(page).focus();
    await page.keyboard.press("r");
    await expect(stageElements(page)).toHaveCount(count + 1);
    await expect(page.getByRole("toolbar", { name: "Shape" })).toBeVisible();
    const rect = page.locator('[data-slide-frame] [data-element-type="shape"]').last();
    const before = await leftOf(rect);
    // Arrow nudges are one undo step per run.
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
    await expect.poll(() => leftOf(rect)).toBeCloseTo(before + 5, 0);
    await page.keyboard.press("Shift+ArrowRight");
    await expect.poll(() => leftOf(rect)).toBeCloseTo(before + 15, 0);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => leftOf(rect)).toBeCloseTo(before + 5, 0);

    // `?` opens the help sheet over the selection; Escape closes the sheet first (the selection
    // stays), and focus comes back to where it was; the next Escape clears the selection.
    await page.keyboard.press("?");
    const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(help).toBeVisible();
    await expect(help.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(help).toHaveCount(0);
    await expect(page.locator("[data-selection-frame]")).toBeVisible();
    await expect(canvas(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-selection-frame]")).toHaveCount(0);

    // ⌘D on the canvas with nothing selected duplicates the slide; ⌘Z takes it back.
    await page.keyboard.press("ControlOrMeta+d");
    await expect(rows(page)).toHaveCount(8);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(rows(page)).toHaveCount(7);

    // The navigator rail: arrows move the active slide, Enter adds one of the same kind after it.
    await rows(page).first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(rows(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(rows(page).nth(1)).toBeFocused();
    const second = await rows(page).nth(1).getAttribute("aria-label");
    await page.keyboard.press("Enter");
    await expect(rows(page)).toHaveCount(8);
    await expect(rows(page).nth(2)).toHaveAttribute("aria-selected", "true");
    expect(await rows(page).nth(2).getAttribute("aria-label")).toBe(
      second?.replace("Slide 2", "Slide 3") ?? "",
    );
    await page.keyboard.press("End");
    await expect(rows(page).last()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(rows(page).first()).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test("narrow viewport (900×700): the editor keeps its rail, navigator and a slide that fits", async ({
    signedInPage: { page, paths },
  }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await page.goto(EDITOR(paths));
    await expect(page.getByRole("heading", { level: 1, name: "The water cycle" })).toBeVisible();
    await expect(page.getByRole("toolbar", { name: "Insert" })).toBeVisible();
    await expect(rows(page).first()).toBeVisible();
    const slide = await frame(page).boundingBox();
    const area = await canvas(page).boundingBox();
    if (!slide || !area) throw new Error("no layout");
    expect(slide.width).toBeLessThanOrEqual(area.width + 1);
    expect(slide.height).toBeLessThanOrEqual(area.height + 1);
    expect(slide.x).toBeGreaterThanOrEqual(area.x - 1);
    // No horizontal scroll: the chrome fits the window.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    // The floating chrome still finds a place: the action pill is on screen and under the top bar.
    const pill = await page.locator("[data-slide-actions]").boundingBox();
    expect(pill?.y ?? 0).toBeGreaterThanOrEqual(72);
    expect((pill?.x ?? 0) + (pill?.width ?? 0)).toBeLessThanOrEqual(900);
    await expectNoSeriousA11yViolations(page, "/l/:id (900px)");
  });

  test("narrow viewport (900×700): the worksheet editor keeps the sheet and its toolbar in reach", async ({
    signedInPage: { page, paths },
  }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await page.goto(paths.worksheet("fraction-practice"));
    await expect(page.getByRole("textbox", { name: "Sheet title" })).toBeVisible();
    const blocks = page.locator(".ws-column .ws-block:not(.ws-rag-slot)");
    await expect(blocks).toHaveCount(9);
    const sheet = await page.locator(".ws-column .ws-page").first().boundingBox();
    if (!sheet) throw new Error("no sheet");
    expect(sheet.x).toBeGreaterThanOrEqual(0);
    expect(sheet.x + sheet.width).toBeLessThanOrEqual(900 + 1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    // A block still selects and shows its toolbar at this width.
    await blocks.first().click();
    await expect(page.getByRole("toolbar").first()).toBeVisible();
    await expectNoSeriousA11yViolations(page, "/w/:id (900px)");
  });
});
