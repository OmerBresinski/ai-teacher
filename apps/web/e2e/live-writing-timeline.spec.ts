/**
 * Live writing P0 (TEACH-202 part d): the timeline of a lesson written over a recorded writer run
 * at its own pace, $0 (`TEACH_LIVE_TIMELINE=1`, opt-in, never in CI; the worker streams
 * `TEACH_LIVE_REPLAY` through the writer planner, see `playwright.config.ts`). It measures, it does
 * not gate: the numbers and frames land in `TEACH_LIVE_OUT` (default `test-results/live-timeline`)
 * for the live writing phases' before and after. The only assertions are that the run happened.
 */
import path from "node:path";
import { expect, test } from "./fixtures";
import { startTimeline } from "./live-timeline";

test.use({ seed: false });

// `TEACH_LIVE_REDUCED=1` runs it with reduced motion (no typing, no caret: each draft at once).
const REDUCED = process.env.TEACH_LIVE_REDUCED === "1";

test("live writing timeline over the recorded writer run", async ({ signedInPage: { page } }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  if (REDUCED) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/lessons/new");
  await page.getByRole("textbox", { name: "Topic", exact: true }).fill("Fractions of amounts");
  await page.getByRole("combobox", { name: "Year group" }).click();
  await page.getByRole("option", { name: "Year 5" }).click();
  const outDir = path.resolve(process.env.TEACH_LIVE_OUT ?? "test-results/live-timeline");
  const t0 = Date.now();
  // Any refusal while the lesson writes is a bug the teacher would see as a toast: log it.
  page.on("response", (r) => {
    if (r.status() >= 400) console.log(`refused ${r.status()} ${r.request().method()} ${r.url()}`);
  });
  await page.getByRole("button", { name: "Skip planning" }).click();
  await expect(page).toHaveURL(/\/l\/[0-9a-f-]{36}$/);
  const frameMs = Number(process.env.TEACH_LIVE_FRAME_MS ?? 500);
  const timeline = await startTimeline(page, { t0, outDir, frameMs });
  // The lesson is written when the editor is up and no slide is marked "Writing…" any more.
  await expect(page.locator("[data-navigator]")).toBeVisible({ timeout: 120_000 });
  await expect(page.locator("[data-navigator] [data-slide-writing]")).toHaveCount(0, {
    timeout: 120_000,
  });
  await page.waitForTimeout(1_500);
  const { metrics, wordMetrics } = await timeline.stop();
  console.log(JSON.stringify({ ...metrics, words: wordMetrics }, null, 2));
  expect(metrics.firstLayoutMs).not.toBeNull();
});
