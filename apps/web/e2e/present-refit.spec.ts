import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/*
 * TEACH-82: a lesson stored under the old floors (`fitVersion: 0`) is re-fitted wherever it opens,
 * not only in the editor. The seeded "electricity" lesson ends on a vocabulary slide whose
 * definitions sit in boxes sized for one line under the old floor (`demo-workspace.ts`
 * `staleLesson`); drawn as stored, each three-line definition runs out of its box and over the row
 * beneath it.
 */

/**
 * Text on the shown slide that runs out of its box into another box, or off the slide. A box's
 * drawn height is its stored one or, when the words need more, theirs (an auto-height box grows at
 * render time); two text boxes that then overlap, or one that ends past the slide, is the defect.
 * Slide units: frames are placed with `left`/`top` in points, so offsets are points too.
 */
async function spilled(slide: ReturnType<Page["locator"]>) {
  await expect(slide.locator('[data-element-type="text"]').first()).toBeVisible();
  return slide.locator('[data-element-type="text"]').evaluateAll((frames) => {
    const drawn = frames.flatMap((frame) => {
      const box = frame as HTMLElement;
      const content = box.firstElementChild as HTMLElement | null;
      if (!content || box.getAttribute("aria-hidden") === "true") return [];
      const h = Math.max(box.clientHeight, content.scrollHeight);
      const x = box.offsetLeft;
      const y = box.offsetTop;
      return [
        {
          id: box.dataset.elementId ?? "?",
          x,
          y,
          w: box.clientWidth,
          h,
          over: h - box.clientHeight,
        },
      ];
    });
    const out: string[] = [];
    for (const a of drawn) {
      if (a.y + a.h > 540 + 1) out.push(`${a.id}: runs ${a.y + a.h - 540}pt off the slide`);
      for (const b of drawn) {
        if (a === b || a.over <= 1) continue;
        const acrossX = a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1;
        const acrossY = a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
        if (acrossX && acrossY) out.push(`${a.id}: runs ${a.over}pt out of its box into ${b.id}`);
      }
    }
    return out;
  });
}

test.describe("a lesson stored under the old floors", () => {
  test("opened straight into Present, its text stays inside its boxes", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(paths.lesson("electricity", "/present"));
    const status = page.getByRole("status").first();
    await expect(status).toContainText("Slide 1 of");
    await page.evaluate(() => document.fonts.ready);
    const total = Number((await status.textContent())?.match(/of (\d+)/)?.[1]);
    expect(total).toBeGreaterThan(1);
    const slide = page.locator('[data-slide-mode="present"]');
    let sawDefinitions = false;
    for (let n = 1; n <= total; n += 1) {
      await expect(status).toContainText(`Slide ${n} of`);
      // The outgoing slide fades while the next comes in: measure once only one is left.
      await expect(slide).toHaveCount(1);
      const text = (await slide.textContent()) ?? "";
      sawDefinitions ||= text.includes("A complete path that lets electricity flow");
      expect(await spilled(slide), `slide ${n}`).toEqual([]);
      // A slide with builds takes a press per step before the next slide.
      for (let press = 0; n < total && press < 10; press += 1) {
        await page.keyboard.press("ArrowRight");
        if (((await status.textContent()) ?? "").includes(`Slide ${n + 1} of`)) break;
      }
    }
    expect(sawDefinitions).toBe(true);
  });

  test("opened in the print route (the PDF), its text stays inside its boxes", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(paths.lesson("electricity", "/print"));
    const pages = page.locator("[data-slide-mode]");
    await expect(pages.first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(
      page.getByText(/A complete path that lets electricity flow/).first(),
    ).toBeVisible();
    for (const one of await pages.all()) expect(await spilled(one)).toEqual([]);
  });
});
