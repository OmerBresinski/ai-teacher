import type { Locator, Page } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "./a11y";
import { expect, test } from "./fixtures";

/*
 * The lesson editor on `/l/$lessonId` (TEACH-103): rows 1, 3, 4, 5, 9 and 11 of the acceptance
 * table with real pointer events, plus the fidelity addendum's computed-style checks against
 * TeachDeck's geometry (navigator 212, rail 56, top bar 48, thumb 168x94, `--shadow-slide`, the
 * zoom cluster 16px in from the corner).
 */

const EDITOR = "/l/demo-water-cycle";

const frame = (page: Page) => page.locator("[data-slide-frame]");
const stageElements = (page: Page) => page.locator("[data-slide-frame] [data-element-id]");
const rows = (page: Page) => page.getByRole("listbox", { name: "Slides" }).getByRole("option");

async function centre(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

/** Playwright `mouse.down / move×steps / up`, the way a hand does it. */
async function drag(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
  steps = 10,
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
  }
  await page.mouse.up();
}

/** The slide's scale on screen: frame width over its 960 logical points. */
async function scaleOf(page: Page) {
  const box = await frame(page).boundingBox();
  if (!box) throw new Error("no frame");
  return box.width / 960;
}

const leftOf = (el: Locator) =>
  el.evaluate((n) => Number.parseFloat((n as HTMLElement).style.left));
const sizeOf = (el: Locator) =>
  el.evaluate((n) => ({
    w: Number.parseFloat((n as HTMLElement).style.width),
    h: Number.parseFloat((n as HTMLElement).style.height),
  }));

/** The browser's normalised rendering of a token, to compare with a computed style. */
const resolved = (page: Page, value: string, property: "boxShadow" = "boxShadow") =>
  page.evaluate(
    ([v, p]) => {
      const probe = document.createElement("div");
      probe.style.setProperty(p === "boxShadow" ? "box-shadow" : p, v);
      document.body.appendChild(probe);
      const out = getComputedStyle(probe)[p as "boxShadow"];
      probe.remove();
      return out;
    },
    [value, property] as const,
  );

test.describe("lesson editor", () => {
  test("row 1: the editor opens with the title, every slide in the navigator, slide 1 at fit and Saved", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons");
    await page.getByRole("link", { name: "Open The water cycle" }).click();
    await expect(page).toHaveURL(/\/l\/demo-water-cycle$/);
    await expect(page.getByRole("heading", { level: 1, name: "The water cycle" })).toBeVisible();
    await expect(page).toHaveTitle("The water cycle · Teaching Journey");

    const count = await rows(page).count();
    expect(count).toBe(7);
    await expect(rows(page).first()).toHaveAttribute("aria-selected", "true");
    // One full-size slide at fit: it sits inside the canvas with the 40px gutter on each side.
    const canvas = await page.getByRole("group", { name: "Slide canvas" }).boundingBox();
    const slide = await frame(page).boundingBox();
    if (!canvas || !slide) throw new Error("no layout");
    expect(Math.abs(slide.width / slide.height - 16 / 9)).toBeLessThan(0.02);
    expect(slide.width).toBeLessThanOrEqual(canvas.width - 80 + 1);
    expect(slide.height).toBeLessThanOrEqual(canvas.height - 80 + 1);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    await expectNoSeriousA11yViolations(page, EDITOR);
  });

  test("fidelity: TeachDeck's geometry to the pixel", async ({ signedInPage: { page } }) => {
    await page.goto(EDITOR);
    await expect(page.getByRole("heading", { level: 1, name: "The water cycle" })).toBeVisible();

    const width = (sel: string) => page.locator(sel).evaluate((n) => getComputedStyle(n).width);
    const height = (sel: string) => page.locator(sel).evaluate((n) => getComputedStyle(n).height);
    expect(await width("[data-navigator]")).toBe("212px");
    expect(await width("[data-insert-rail]")).toBe("56px");
    expect(await height("[data-topbar]")).toBe("48px");

    const activeThumb = rows(page).first().locator("[data-navigator-thumb]");
    expect(await activeThumb.evaluate((n) => getComputedStyle(n).width)).toBe("168px");
    expect(await activeThumb.evaluate((n) => getComputedStyle(n).height)).toBe("94px");
    expect(await activeThumb.evaluate((n) => getComputedStyle(n).boxShadow)).toBe(
      await resolved(page, "0 0 0 2px var(--primary)"),
    );
    expect(
      await rows(page)
        .nth(1)
        .locator("[data-navigator-thumb]")
        .evaluate((n) => getComputedStyle(n).boxShadow),
    ).toBe(await resolved(page, "0 0 0 1px var(--border)"));

    expect(await frame(page).evaluate((n) => getComputedStyle(n).boxShadow)).toBe(
      await resolved(page, "var(--shadow-slide)"),
    );
    expect(await frame(page).evaluate((n) => getComputedStyle(n).borderRadius)).toBe("12px");

    const cluster = page.locator("[data-canvas-footer]");
    expect(await cluster.evaluate((n) => getComputedStyle(n).right)).toBe("16px");
    expect(await cluster.evaluate((n) => getComputedStyle(n).bottom)).toBe("16px");
    expect(await cluster.evaluate((n) => getComputedStyle(n).height)).toBe("32px");
    // The slide action pill floats in the band above the slide, never nearer the top than 72px.
    const pill = await page.locator("[data-slide-actions]").boundingBox();
    expect(pill?.y ?? 0).toBeGreaterThanOrEqual(72);
  });

  test("row 3: dragging an element 40px right moves it 40/scale points, as one undo step", async ({
    signedInPage: { page },
  }) => {
    await page.goto(EDITOR);
    await expect(frame(page)).toBeVisible();
    const scale = await scaleOf(page);
    // The title on slide 1: the largest text box, the easiest to hit.
    const title = stageElements(page).filter({ hasText: "The water cycle" }).first();
    const before = await leftOf(title);
    const at = await centre(title);
    // Straight along x so the vertical position, and every guide on that axis, stays put; snap is
    // off by ⌘ during the drag so the pure delta is what lands.
    await page.keyboard.down("Meta");
    await drag(page, at, 40, 0);
    await page.keyboard.up("Meta");

    // The cache write lands on TanStack's notify tick, so read with a retrying poll.
    await expect.poll(() => leftOf(title)).toBeCloseTo(before + 40 / scale, 1);
    await expect(page.locator("[data-selection-frame]")).toBeVisible();
    await expect(page.locator("[data-handle]")).toHaveCount(8);

    const undo = page.getByRole("button", { name: "Undo" });
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect.poll(() => leftOf(title)).toBeCloseTo(before, 3);
    await expect(undo).toBeDisabled();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  });

  test("row 4: a drag near a sibling's edge snaps to it with a guide; snap off leaves it where it lands", async ({
    signedInPage: { page },
  }) => {
    await page.goto(EDITOR);
    await expect(frame(page)).toBeVisible();
    const scale = await scaleOf(page);
    const title = stageElements(page).filter({ hasText: "The water cycle" }).first();
    const before = await leftOf(title);
    const at = await centre(title);

    // 5 screen px is inside the 8px threshold: the left edge snaps back onto the caption's.
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 2, at.y);
    await page.mouse.move(at.x + 5, at.y);
    await expect(page.locator('[data-guide="x"]').first()).toBeVisible();
    await page.mouse.up();
    await expect.poll(() => leftOf(title)).toBeCloseTo(before, 3);

    // Snap off from the canvas options, and the same drag lands 5/scale points over.
    await page.getByRole("button", { name: "Canvas options" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Snap to guides" }).click();
    await page.keyboard.press("Escape");
    const again = await centre(title);
    await page.mouse.move(again.x, again.y);
    await page.mouse.down();
    await page.mouse.move(again.x + 2, again.y);
    await page.mouse.move(again.x + 5, again.y);
    await expect(page.locator('[data-guide="x"]')).toHaveCount(0);
    await page.mouse.up();
    await expect.poll(() => leftOf(title)).toBeCloseTo(before + 5 / scale, 1);
  });

  test("row 5: a corner handle resizes; Shift on a shape releases the aspect lock", async ({
    signedInPage: { page },
  }) => {
    await page.goto(EDITOR);
    await expect(frame(page)).toBeVisible();
    const scale = await scaleOf(page);
    // A fresh rectangle from the rail: shapes lock aspect by default (text boxes do not).
    await page.getByRole("button", { name: "Shape" }).click();
    const rect = page.locator('[data-slide-frame] [data-element-type="shape"]').last();
    await expect(page.locator("[data-selection-frame]")).toBeVisible();
    const start = await sizeOf(rect);

    const se = await centre(page.locator('[data-handle="se"]'));
    await drag(page, se, 60, 10, 6);
    await expect.poll(async () => (await sizeOf(rect)).w).toBeGreaterThan(start.w);
    const locked = await sizeOf(rect);
    expect(locked.w / locked.h).toBeCloseTo(start.w / start.h, 2);

    // Shift frees the ratio; ⌘ keeps the edges from snapping to a neighbour on the way.
    const se2 = await centre(page.locator('[data-handle="se"]'));
    await page.keyboard.down("Shift");
    await page.keyboard.down("Meta");
    await drag(page, se2, 40, -20, 6);
    await page.keyboard.up("Meta");
    await page.keyboard.up("Shift");
    await expect.poll(async () => (await sizeOf(rect)).w).toBeCloseTo(locked.w + 40 / scale, 0);
    const free = await sizeOf(rect);
    expect(free.h - locked.h).toBeCloseTo(-20 / scale, 0);
  });

  test("row 9: ⌘↓ moves slide 2 down; dragging slide 1 below slide 3 reorders", async ({
    signedInPage: { page },
  }) => {
    await page.goto(EDITOR);
    await expect(rows(page)).toHaveCount(7);
    const label = (i: number) => rows(page).nth(i).getAttribute("aria-label");
    const second = await label(1);
    const third = await label(2);

    await rows(page).nth(1).click();
    await expect(rows(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Meta+ArrowDown");
    await expect(rows(page).nth(1)).toHaveAttribute(
      "aria-label",
      third?.replace("Slide 3", "Slide 2") ?? "",
    );
    await expect(rows(page).nth(2)).toHaveAttribute(
      "aria-label",
      second?.replace("Slide 2", "Slide 3") ?? "",
    );
    await page.keyboard.press("Meta+ArrowUp");
    await expect(rows(page).nth(1)).toHaveAttribute("aria-label", second ?? "");

    // Pointer: slide 1 to below slide 3.
    const first = await label(0);
    const from = await centre(rows(page).nth(0));
    const target = await rows(page).nth(2).boundingBox();
    if (!target) throw new Error("no row");
    await drag(page, from, 0, target.y + target.height - from.y, 8);
    await expect(rows(page).nth(2)).toHaveAttribute(
      "aria-label",
      first?.replace("Slide 1", "Slide 3") ?? "",
    );
    await expect(rows(page).nth(0)).toHaveAttribute(
      "aria-label",
      second?.replace("Slide 2", "Slide 1") ?? "",
    );
  });

  test("row 11: renaming the title autosaves and the library card shows it", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons");
    await page.getByRole("link", { name: "Open The water cycle" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "The water cycle" })).toBeVisible();

    await page.getByRole("button", { name: "Rename lesson" }).click();
    const input = page.getByRole("textbox", { name: "Lesson title" });
    await input.fill("Rain, rivers and seas");
    await input.press("Enter");
    await expect(
      page.getByRole("heading", { level: 1, name: "Rain, rivers and seas" }),
    ).toBeVisible();
    await expect(page.getByText("Unsaved changes")).toBeVisible();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 5_000 });

    // Client-side back (a reload would reseed the mock library): the card has the new title.
    await page.getByRole("button", { name: "Back to library" }).click();
    await expect(page).toHaveURL(/\/lessons$/);
    await expect(page.getByRole("link", { name: "Open Rain, rivers and seas" })).toBeVisible();
  });

  test("row 14: zoom shortcuts step through ZOOM_STEPS and ⌘⌥0 fits", async ({
    signedInPage: { page },
  }) => {
    await page.goto(EDITOR);
    await expect(frame(page)).toBeVisible();
    const readout = page.getByRole("button", { name: /^Zoom, \d+ percent$/ });
    const fit = await frame(page).boundingBox();
    await page.keyboard.press("Meta+0");
    await expect(readout).toHaveAccessibleName("Zoom, 100 percent");
    expect((await frame(page).boundingBox())?.width).toBeCloseTo(960, 0);
    await page.keyboard.press("Meta+Equal");
    await expect(readout).toHaveAccessibleName("Zoom, 150 percent");
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expect(readout).toHaveAccessibleName("Zoom, 100 percent");
    await page.keyboard.press("Meta+Alt+0");
    expect((await frame(page).boundingBox())?.width).toBeCloseTo(fit?.width ?? 0, 0);
  });
});
