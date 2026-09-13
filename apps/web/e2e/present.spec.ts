import { expectNoSeriousA11yViolations } from "./a11y";
import { expect, type SeededPaths, test } from "./fixtures";

const PRESENT = (paths: SeededPaths) => paths.lesson("demo-water-cycle", "/present");
const status = (page: import("@playwright/test").Page) => page.getByRole("status").first();

test.describe("present mode", () => {
  test("stays on the stage palette in every app theme and letterboxes the slide", async ({
    signedInPage: { page, paths },
  }) => {
    for (const theme of ["light", "dark", "high-contrast"] as const) {
      await page.addInitScript((value) => localStorage.setItem("tj-theme", value), theme);
      await page.goto(PRESENT(paths));
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
    signedInPage: { page, paths },
  }) => {
    await page.goto(PRESENT(paths));
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
    signedInPage: { page, paths },
  }) => {
    await page.goto(PRESENT(paths));
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
    signedInPage: { page, paths },
  }) => {
    await page.goto(PRESENT(paths));
    await page.getByRole("button", { name: "Stay in this window" }).click();
    await page.keyboard.press("t");
    const panel = page.getByRole("radiogroup", { name: "Timer mode" });
    await expect(panel).toBeVisible();
    await page.getByRole("button", { name: "1 min" }).click();
    const readout = page.getByRole("timer");
    await expect(readout).toBeVisible();
    await expect(readout).toHaveText(/00:5\d|0:5\d/);
  });

  // TEACH-113: the remaining shortcut groups (Tools H/L, Screen C/F, Panels N/?) and the nested
  // Escape order — sheet, then panel, then tool, then exit — over the real key handler.
  test("H, L, C, N and ? each toggle their control; Escape closes the sheet, the panel, the tool, then exits", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(PRESENT(paths));
    await page.getByRole("button", { name: "Stay in this window" }).click();
    await expect(status(page)).toContainText("Slide 1 of");
    const pressed = (name: string) =>
      page.getByRole("button", { name, exact: true }).getAttribute("aria-pressed");

    await page.keyboard.press("h");
    expect(await pressed("Highlighter")).toBe("true");
    await page.keyboard.press("l");
    expect(await pressed("Laser pointer")).toBe("true");
    expect(await pressed("Highlighter")).toBe("false"); // a tool and the laser are exclusive
    await page.keyboard.press("l");
    expect(await pressed("Laser pointer")).toBe("false");

    // C collapses the pill to the counter; the tool buttons go with it, and C brings them back.
    await page.keyboard.press("c");
    await expect(page.getByRole("button", { name: "Expand controls" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Highlighter", exact: true })).toHaveCount(0);
    await page.keyboard.press("c");
    await expect(page.getByRole("button", { name: "Collapse controls" })).toBeVisible();

    // F asks for fullscreen; headless Chromium refuses, and the deck is still on its slide.
    await page.keyboard.press("f");
    await expect(status(page)).toContainText("Slide 1 of");

    // N opens the presenter notes with the next slide; ? the shortcuts sheet on top.
    await page.keyboard.press("n");
    const notes = page.getByRole("complementary", { name: "Presenter notes" });
    await expect(notes).toBeVisible();
    await expect(notes.getByText(/Next/)).toBeVisible();
    await page.keyboard.press("h");
    expect(await pressed("Highlighter")).toBe("true");
    await page.keyboard.press("?");
    const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveClass(/tj-stage/);
    for (const group of ["Moving", "Screen", "Tools", "Panels"]) {
      await expect(sheet.getByRole("heading", { name: group })).toBeVisible();
    }

    // Nested Escape: the sheet, then the notes panel, then the highlighter, then the exit.
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(notes).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(notes).toBeHidden();
    expect(await pressed("Highlighter")).toBe("true");
    await page.keyboard.press("Escape");
    expect(await pressed("Highlighter")).toBe("false");
    await expect(page).toHaveURL(/present/);
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(new RegExp(`${paths.lesson("demo-water-cycle")}$`));
  });

  test("presenting from a series chains to the next lesson and exits to the series", async ({
    signedInPage: { page, paths },
  }) => {
    const romans = paths.id("series-romans");
    await page.goto(paths.series("series-romans"));
    await page.getByRole("button", { name: "Present series" }).click();
    await expect(page).toHaveURL(
      new RegExp(`${paths.lesson("roman-roads", "/present")}\\?series=${romans}$`),
    );
    await page.getByRole("button", { name: "Stay in this window" }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Space");
    await expect(page.getByRole("heading", { name: "End of lesson" })).toBeVisible();
    await expect(page.getByText("Next: Fractions of amounts", { exact: true })).toBeVisible();
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(
      new RegExp(`${paths.lesson("demo-fractions", "/present")}\\?series=${romans}$`),
    );
    await page.getByRole("button", { name: "Stay in this window" }).click();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(new RegExp(`${paths.series("series-romans")}$`));
  });

  test("?slide= opens on that slide; Escape from the viewer's Present returns to the viewer", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(paths.lesson("demo-water-cycle", "/view"));
    await expect(page.getByRole("status")).toHaveText(/Slide 1 of/);
    await page.keyboard.press("ArrowRight");
    await page.getByRole("button", { name: "Present" }).click();
    await expect(page).toHaveURL(/present\?(from=view&slide=2|slide=2&from=view)$/);
    await page.getByRole("button", { name: "Stay in this window" }).click();
    await expect(status(page)).toContainText("Slide 2 of");
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(new RegExp(`${paths.lesson("demo-water-cycle", "/view")}$`));
  });

  test("Escape from the editor's Present returns to the editor", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(paths.lesson("demo-water-cycle"));
    await page.getByRole("button", { name: "Present" }).click();
    await expect(page).toHaveURL(/present\?from=edit$/);
    await page.getByRole("button", { name: "Stay in this window" }).click();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(new RegExp(`${paths.lesson("demo-water-cycle")}$`));
    await expect(page.getByRole("listbox", { name: "Slides" })).toBeVisible();
  });
});
