import { expectNoSeriousA11yViolations } from "./a11y";
import { expect, test } from "./fixtures";

const PRESENT = "/l/demo-water-cycle/present";
const status = (page: import("@playwright/test").Page) => page.getByRole("status").first();

test.describe("present mode", () => {
  test("stays on the stage palette in every app theme and letterboxes the slide", async ({
    signedInPage: { page },
  }) => {
    for (const theme of ["light", "dark", "high-contrast"] as const) {
      await page.addInitScript((value) => localStorage.setItem("tj-theme", value), theme);
      await page.goto(PRESENT);
      const root = page.locator("[data-present-root]");
      await expect(root).toHaveClass(/tj-stage/);
      const tokens = await root.evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          background: style.getPropertyValue("--background").trim(),
          card: style.getPropertyValue("--card").trim(),
          paint: style.backgroundColor,
        };
      });
      expect(tokens.background, theme).toBe("#141312");
      expect(tokens.card, theme).toBe("#1f1d1b");
      expect(tokens.paint, theme).toBe("rgb(20, 19, 18)");
    }
    await page.getByRole("button", { name: "Stay in this window" }).click();
    const slide = page.locator('[data-slide-mode="present"]');
    await expect(slide).toHaveCount(1);
    const box = await slide.boundingBox();
    const viewport = page.viewportSize();
    expect(box && viewport && Math.abs(box.width / box.height - 16 / 9) < 0.02).toBe(true);
    expect(box && viewport && box.width <= viewport.width && box.height <= viewport.height).toBe(
      true,
    );
    await expectNoSeriousA11yViolations(page, "present (stage)");
  });

  test("keys move the deck; B/W blank the screen; digits jump; O opens the overview", async ({
    signedInPage: { page },
  }) => {
    await page.goto(PRESENT);
    await page.getByRole("button", { name: "Stay in this window" }).click();
    await expect(status(page)).toContainText("Slide 1 of");
    await page.keyboard.press("Space");
    await expect(status(page)).toContainText("Slide 2 of");
    await page.keyboard.press("ArrowLeft");
    await expect(status(page)).toContainText("Slide 1 of");
    await page.keyboard.press("3");
    await expect(page.getByText("Go to slide 3")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(status(page)).toContainText("Slide 3 of");

    const overlay = page.locator("[data-present-stage] > [aria-hidden]").last();
    await page.keyboard.press("b");
    await expect(overlay).toHaveCSS("opacity", "1");
    await expect(overlay).toHaveCSS("background-color", "rgb(0, 0, 0)");
    await page.keyboard.press("ArrowRight");
    await expect(overlay).toHaveCSS("opacity", "0");
    await expect(status(page)).toContainText("Slide 3 of");
    await page.keyboard.press("w");
    await expect(overlay).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await page.keyboard.press("Escape");

    await page.keyboard.press("o");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveClass(/tj-stage/);
    await dialog.getByRole("button", { name: /^Slide 5/ }).click();
    await expect(dialog).toBeHidden();
    await expect(status(page)).toContainText("Slide 5 of");
    await expectNoSeriousA11yViolations(page, "present (deck)");
  });

  test("pen draws a stroke with real pointer events; X clears; eraser removes", async ({
    signedInPage: { page },
  }) => {
    await page.goto(PRESENT);
    await page.getByRole("button", { name: "Stay in this window" }).click();
    await expect(status(page)).toContainText("Slide 1 of");
    await page.keyboard.press("p");
    await expect(page.getByRole("button", { name: "Pen", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const slide = page.locator('[data-slide-mode="present"]');
    const box = await slide.boundingBox();
    if (!box) throw new Error("slide not laid out");
    // The pen layer is the interactive svg with pointer events on; the blend layer beneath it
    // (highlighter) is pointer-events-none and stays empty for a pen stroke.
    const inkSvg = page.locator('[data-ink-layer="pen"]');
    const strokes = () => inkSvg.locator("path[d]:not([d=''])").count();
    expect(await strokes()).toBe(0);

    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) {
      await page.mouse.move(box.x + box.width * (0.3 + i * 0.04), box.y + box.height * 0.5, {
        steps: 2,
      });
    }
    await page.mouse.up();
    await expect.poll(strokes).toBe(1);
    // The stroke is ink, not a slide advance.
    await expect(status(page)).toContainText("Slide 1 of");

    await page.keyboard.press("x");
    await expect.poll(strokes).toBe(0);

    // Draw again, then erase over it.
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 8 });
    await page.mouse.up();
    await expect.poll(strokes).toBe(1);
    await page.keyboard.press("e");
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.46, box.y + box.height * 0.6, { steps: 2 });
    await page.mouse.up();
    await expect.poll(strokes).toBe(0);
  });

  test("the timer counts down from a preset and shows on the stage", async ({
    signedInPage: { page },
  }) => {
    await page.goto(PRESENT);
    await page.getByRole("button", { name: "Stay in this window" }).click();
    await page.keyboard.press("t");
    const panel = page.getByRole("radiogroup", { name: "Timer mode" });
    await expect(panel).toBeVisible();
    await page.getByRole("button", { name: "1 min" }).click();
    const readout = page.getByRole("timer");
    await expect(readout).toBeVisible();
    await expect(readout).toHaveText(/00:5\d|0:5\d/);
  });

  test("presenting from a series chains to the next lesson and exits to the series", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/series/series-romans");
    await page.getByRole("button", { name: "Present series" }).click();
    await expect(page).toHaveURL(/\/l\/roman-roads\/present\?series=series-romans$/);
    await page.getByRole("button", { name: "Stay in this window" }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Space");
    await expect(page.getByRole("heading", { name: "End of lesson" })).toBeVisible();
    await expect(page.getByText("Next: Fractions of amounts", { exact: true })).toBeVisible();
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(/\/l\/demo-fractions\/present\?series=series-romans$/);
    await page.getByRole("button", { name: "Stay in this window" }).click();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/series\/series-romans$/);
  });

  test("?slide= opens on that slide; Escape from the viewer's Present returns to the lesson", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/l/demo-water-cycle");
    await expect(page.getByRole("status")).toHaveText(/Slide 1 of/);
    await page.keyboard.press("ArrowRight");
    await page.getByRole("button", { name: "Present" }).click();
    await expect(page).toHaveURL(/present\?slide=2$/);
    await page.getByRole("button", { name: "Stay in this window" }).click();
    await expect(status(page)).toContainText("Slide 2 of");
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/l\/demo-water-cycle$/);
  });
});
