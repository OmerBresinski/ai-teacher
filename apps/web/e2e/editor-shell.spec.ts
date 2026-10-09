import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/*
 * Layout A's shell rules in the real editor (rulings 186, 187). The window is resized across
 * 1024-2560 x 700-1440 with the Dayback pane open and closed, and the rects on screen are measured:
 * the slide never lies under the pane, the toolbar or the slide actions pill; where the pane's
 * space is reserved, opening it never changes the slide's size; the pane's text stays readable.
 * Plus the overlay below that, the first paint, Escape, the landmarks and the folded strip. Facts in
 * the same slot is checked in `proposals.spec.ts`, on the seeded lesson that has facts.
 */

type Rect = { x: number; y: number; width: number; height: number };
const right = (r: Rect) => r.x + r.width;
const bottom = (r: Rect) => r.y + r.height;
const overlaps = (a: Rect, b: Rect) =>
  a.x < right(b) - 0.5 && b.x < right(a) - 0.5 && a.y < bottom(b) - 0.5 && b.y < bottom(a) - 0.5;

export const frame = (page: Page) => page.locator("[data-slide-frame]").first();
const pane = (page: Page) => page.getByRole("complementary", { name: "Edit with Dayback" });
const bubble = (page: Page) => page.locator("[data-edit-chat-bubble]");

async function rect(locator: Locator): Promise<Rect> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return box;
}

/** The slide's rect once it has stopped moving (opening the pane recentres it with a transition). */
async function settledFrame(page: Page): Promise<Rect> {
  let last = await rect(frame(page));
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(100);
    const next = await rect(frame(page));
    if (Math.abs(next.x - last.x) < 0.5 && Math.abs(next.width - last.width) < 0.5) return next;
    last = next;
  }
  return last;
}

async function setPane(page: Page, open: boolean) {
  if (open && !(await pane(page).isVisible())) await bubble(page).click();
  if (!open && (await pane(page).isVisible())) {
    await page.getByPlaceholder("Ask Slides to change something…").focus();
    await page.keyboard.press("Escape");
  }
  await expect(pane(page)).toBeVisible({ visible: open });
}

/** Every floating bar over the canvas: the contextual toolbar and the slide actions pill. */
async function chromeRects(page: Page): Promise<Rect[]> {
  const out: Rect[] = [];
  for (const sel of ["[data-contextual-toolbar]", "[data-slide-actions]"]) {
    for (const el of await page.locator(sel).all()) {
      if (await el.isVisible()) out.push(await rect(el));
    }
  }
  return out;
}

const SIZES: [number, number][] = [
  [1024, 700],
  [1024, 768],
  [1280, 720],
  [1280, 800],
  [1366, 768],
  [1440, 900],
  [1536, 864],
  [1680, 1050],
  [1920, 1080],
  [1920, 1200],
  [2048, 1152],
  [2560, 1080],
  [2560, 1440],
];

test.describe("editor shell (layout A, rulings 186 and 187)", () => {
  test("across window sizes the slide fits beside the pane and nothing lies over it", async ({
    signedInPage: { page, paths },
  }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => localStorage.setItem("dayback.edit-pane.open", "0"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(paths.lesson("demo-water-cycle"));
    await expect(frame(page)).toBeVisible();

    for (const [w, h] of SIZES) {
      const at = `${w}x${h}`;
      await page.setViewportSize({ width: w, height: h });
      await setPane(page, false);
      const closed = await settledFrame(page);
      await setPane(page, true);
      const open = await settledFrame(page);
      const paneBox = await rect(pane(page));
      const canvas = await rect(page.locator("[data-canvas]"));

      // Every size in the sweep reserves the pane's width (ruling 187).
      await expect(pane(page), at).toHaveAttribute("data-side-pane", "docked");
      // The pane is clamp(304, 20vw + 64, 420).
      expect(paneBox.width, at).toBeCloseTo(Math.min(420, Math.max(304, w * 0.2 + 64)), 0);
      // Reserved: opening the pane recentres the slide but never re-fits it.
      expect(open.width, at).toBeCloseTo(closed.width, 0);
      expect(open.height, at).toBeCloseTo(closed.height, 0);
      // The slide fits the canvas that is left and never lies under the pane.
      expect(open.x, at).toBeGreaterThanOrEqual(canvas.x);
      expect(right(open), at).toBeLessThanOrEqual(paneBox.x + 0.5);
      expect(bottom(open), at).toBeLessThanOrEqual(bottom(canvas) + 0.5);
      // No floating bar over the slide or the pane.
      for (const bar of await chromeRects(page)) {
        expect(overlaps(bar, open), `${at} bar over the slide`).toBe(false);
        expect(overlaps(bar, paneBox), `${at} bar under the pane`).toBe(false);
      }
      // The pane's text stays readable: 13 px or more.
      const sizes = await pane(page)
        .locator("p, textarea, button, span")
        .evaluateAll((els) =>
          els
            .filter((el) => (el as HTMLElement).offsetParent !== null && el.textContent?.trim())
            .map((el) => Number.parseFloat(getComputedStyle(el).fontSize)),
        );
      expect(sizes.length, at).toBeGreaterThan(0);
      expect(Math.min(...sizes), at).toBeGreaterThanOrEqual(13);
    }
  });

  test("below the sweep the pane lies over the filmstrip and the slide keeps its full fit", async ({
    signedInPage: { page, paths },
  }) => {
    await page.addInitScript(() => localStorage.setItem("dayback.edit-pane.open", "0"));
    await page.setViewportSize({ width: 960, height: 700 });
    await page.goto(paths.lesson("demo-water-cycle"));
    await expect(frame(page)).toBeVisible();
    const closed = await settledFrame(page);
    await setPane(page, true);
    await expect(pane(page)).toHaveAttribute("data-side-pane", "overlay");
    const open = await settledFrame(page);
    expect(open.width).toBeCloseTo(closed.width, 0);
  });

  test("the first paint is the measured mode: no flip, and the bubble mounts once", async ({
    signedInPage: { page, paths },
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("dayback.edit-pane.open", "0");
      // Every bubble element that is ever attached: a remount would attach a second one.
      const seen = new Set<Element>();
      (window as unknown as { __bubbles: Set<Element> }).__bubbles = seen;
      new MutationObserver((records) => {
        for (const r of records)
          for (const n of r.addedNodes) {
            if (!(n instanceof HTMLElement)) continue;
            if (n.matches("[data-edit-chat-bubble]")) seen.add(n);
            for (const b of n.querySelectorAll("[data-edit-chat-bubble]")) seen.add(b);
          }
      }).observe(document, { childList: true, subtree: true });
    });
    await page.setViewportSize({ width: 960, height: 700 });
    await page.goto(paths.lesson("demo-water-cycle"));
    await expect(bubble(page)).toBeVisible();
    await page.waitForTimeout(500);
    const added = await page.evaluate(
      () => (window as unknown as { __bubbles: Set<Element> }).__bubbles.size,
    );
    expect(added).toBe(1);
  });

  test("Escape closes the pane and the bubble takes the focus; the landmarks are named", async ({
    signedInPage: { page, paths },
  }) => {
    await page.addInitScript(() => localStorage.setItem("dayback.edit-pane.open", "1"));
    await page.goto(paths.lesson("demo-water-cycle"));
    await expect(pane(page)).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Slide strip" })).toBeVisible();
    await expect(page.getByRole("listbox", { name: "Slides" })).toBeVisible();
    await expect(page.getByRole("main")).toHaveCount(1);
    await page.getByPlaceholder("Ask Slides to change something…").focus();
    await page.keyboard.press("Escape");
    await expect(pane(page)).toBeHidden();
    await expect(bubble(page)).toBeFocused();
    await expect(page.getByRole("complementary", { name: "Edit with Dayback" })).toHaveCount(0);
  });

  test("folded to dots, the strip keeps its keys: arrows move, ⌘ arrows reorder", async ({
    signedInPage: { page, paths },
  }) => {
    await page.addInitScript(() => localStorage.setItem("dayback.edit-pane.open", "0"));
    await page.goto(paths.lesson("demo-water-cycle"));
    const options = page.getByRole("listbox", { name: "Slides" }).getByRole("option");
    await expect(options).toHaveCount(7);
    const third = await options.nth(2).getAttribute("aria-label");
    await page.getByRole("button", { name: "Collapse slide strip" }).click();
    await expect(options.first()).toHaveAttribute("aria-label", "Slide 1");
    // A click on a dot opens its slide.
    await options.nth(1).click();
    await expect(options.nth(1)).toHaveAttribute("aria-current", "true");
    await expect(options.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(options.nth(2)).toHaveAttribute("aria-current", "true");
    await expect(options.nth(2)).toBeFocused();
    // ⌘← moves slide 3 to second place.
    await page.keyboard.press("Meta+ArrowLeft");
    await page.getByRole("button", { name: "Show slide strip" }).click();
    await expect(options.nth(1)).toHaveAttribute(
      "aria-label",
      third?.replace("Slide 3", "Slide 2") ?? "",
    );
  });
});
