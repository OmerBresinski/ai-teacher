/**
 * Jobs + SSE (ADR 0006/0012) through the `/dev/jobs` development page: enqueue a `ping`, watch
 * the worker's events stream in, cancel mid-run, and prove `Last-Event-ID`-free replay by
 * reloading while the job is running. The ping job takes 300 ms per step (5 steps), so every
 * timing assertion goes through `expect.poll` / auto-retrying `expect` rather than sleeps.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const eventList = (page: Page): Locator => page.getByRole("list", { name: "Job events" });
const eventTexts = async (page: Page): Promise<string[]> =>
  (await eventList(page).getByRole("listitem").allInnerTexts()).map((t) =>
    t.replace(/\s+/g, " ").trim(),
  );
/** Drop the timestamp column so texts can be compared across a reload. */
const describe = (text: string): string => text.replace(/^\d{2}:\d{2}:\d{2}\.\d{3}\s*/, "");

test.describe("jobs / SSE demo", () => {
  test("run ping → events stream in → completed", async ({ signedInPage: { page } }) => {
    await page.goto("/dev/jobs");
    await page.getByRole("button", { name: "Run ping" }).click();

    await expect(page).toHaveURL(/jobId=/);
    await expect
      .poll(async () => (await eventTexts(page)).map(describe), { timeout: 15_000 })
      .toContain("completed");
    const events = (await eventTexts(page)).map(describe);
    expect(events[0]).toBe("queued");
    expect(events).toContain("started");
    expect(events).toContain("progress 100% — step 5/5");
    expect(events.at(-1)).toBe("completed");
    await expect(page.getByRole("progressbar")).toHaveAttribute("value", "100");
    await expect(page.getByText(/· closed$/)).toBeVisible();
  });

  test("cancel mid-run ends in cancelled, never completed", async ({ signedInPage: { page } }) => {
    await page.goto("/dev/jobs");
    await page.getByRole("button", { name: "Run ping" }).click();
    await expect.poll(async () => (await eventTexts(page)).map(describe)).toContain("started");

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect
      .poll(async () => (await eventTexts(page)).map(describe), { timeout: 15_000 })
      .toContain("cancelled");
    // Give a would-be stray `completed` time to arrive; it must not.
    await page.waitForTimeout(700);
    const events = (await eventTexts(page)).map(describe);
    expect(events.at(-1)).toBe("cancelled");
    expect(events).not.toContain("completed");
    expect(events.filter((e) => e === "cancelled")).toHaveLength(1);
  });

  test("reload mid-run replays the events already seen, then finishes", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/dev/jobs");
    await page.getByRole("button", { name: "Run ping" }).click();

    // Wait until the job is genuinely running: at least one progress event, not yet terminal.
    await expect
      .poll(async () =>
        (await eventTexts(page)).map(describe).some((e) => e.startsWith("progress")),
      )
      .toBe(true);
    const seenBefore = (await eventTexts(page)).map(describe);
    expect(seenBefore).toContain("queued");
    expect(seenBefore).toContain("started");
    expect(seenBefore).not.toContain("completed");
    const url = page.url();

    await page.reload();
    await expect(page).toHaveURL(url);

    // Replay: everything seen before the reload shows up again, in the same order, and the
    // stream then carries on to the terminal event.
    await expect
      .poll(async () => (await eventTexts(page)).map(describe), { timeout: 15_000 })
      .toContain("completed");
    const afterReload = (await eventTexts(page)).map(describe);
    expect(afterReload.slice(0, seenBefore.length)).toEqual(seenBefore);
    expect(afterReload.at(-1)).toBe("completed");
    // No duplicates: replay + live delivery never double-deliver a row.
    expect(new Set(afterReload).size).toBe(afterReload.length);
  });
});
