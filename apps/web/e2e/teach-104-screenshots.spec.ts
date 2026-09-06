/**
 * Screenshots and the typing-latency number for the TEACH-104 PR. Opt-in:
 * `TEACH_SCREENSHOTS=1 bun --bun playwright test e2e/teach-104-screenshots.spec.ts`.
 */
import { expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 900 } });

test("captures the editor with text editing open and measures keystroke-to-paint", async ({
  signedInPage: { page },
}) => {
  await page.goto("/l/demo-water-cycle");
  const title = page
    .locator("[data-slide-frame] [data-element-id]")
    .filter({ hasText: "The water cycle" })
    .first();
  const b = await title.boundingBox();
  if (!b) throw new Error("no title");
  await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2);
  const pm = page.locator("[data-slide-frame] .ProseMirror");
  await expect(pm).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.type(" and rain");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "/tmp/teach-104-editing.png" });

  // Keystroke → next paint with the text on screen, over 40 characters, measured in the page.
  const samples = await page.evaluate(async () => {
    const editor = document.querySelector<HTMLElement>("[data-slide-frame] .ProseMirror");
    if (!editor) throw new Error("no editor");
    const out: number[] = [];
    for (let i = 0; i < 40; i++) {
      const t0 = performance.now();
      document.execCommand("insertText", false, "x");
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      out.push(performance.now() - t0);
    }
    return out;
  });
  const sorted = [...samples].sort((a, c) => a - c);
  const p50 = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  console.log(
    `typing latency (keystroke→paint, n=${samples.length}): p50 ${p50?.toFixed(1)} ms, p95 ${p95?.toFixed(1)} ms, max ${sorted[sorted.length - 1]?.toFixed(1)} ms`,
  );

  await page.keyboard.press("Meta+a");
  await page.getByRole("toolbar", { name: "Text" }).getByRole("button", { name: "Link" }).click();
  await page.getByRole("textbox", { name: "Link address" }).fill("javascript:alert(1)");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toBeVisible();
  await page.screenshot({ path: "/tmp/teach-104-link-refused.png" });
});
