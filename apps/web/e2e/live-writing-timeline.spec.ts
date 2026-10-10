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

test("live writing timeline over the recorded writer run", async ({ signedInPage: { page } }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/lessons/new");
  await page.getByRole("textbox", { name: "Topic", exact: true }).fill("Fractions of amounts");
  await page.getByRole("combobox", { name: "Year group" }).click();
  await page.getByRole("option", { name: "Year 5" }).click();
  const outDir = path.resolve(process.env.TEACH_LIVE_OUT ?? "test-results/live-timeline");
  const t0 = Date.now();
  await page.getByRole("button", { name: "Skip planning" }).click();
  await expect(page).toHaveURL(/\/l\/[0-9a-f-]{36}$/);
  const timeline = await startTimeline(page, { t0, outDir, frameMs: 500 });
  // The lesson is written when the editor is up and no slide is marked "Writing…" any more.
  await expect(page.locator("[data-navigator]")).toBeVisible({ timeout: 120_000 });
  await expect(page.locator("[data-navigator] [data-slide-writing]")).toHaveCount(0, {
    timeout: 120_000,
  });
  await page.waitForTimeout(1_500);
  const { metrics } = await timeline.stop();
  console.log(JSON.stringify(metrics, null, 2));
  expect(metrics.firstLayoutMs).not.toBeNull();
});
