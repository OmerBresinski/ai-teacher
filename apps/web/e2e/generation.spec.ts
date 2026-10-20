/**
 * TEACH-133: a lesson generated end to end over the fake worker (`AI_FAKE_SCRIPT=pipeline`, paced
 * 250 ms per model answer, ADR 0025 §22). From the brief screen to `/l/$lessonId`: the generating
 * shell and its stage strip, slides arriving before the job ends (the `documentUpdatedAt`
 * refetch, §7), the editor taking over in place with no reload, the residual entry fed by the fake review's warning (§12)
 * (§4). The lesson job writes no worksheet since ADR 0030 (the sheet is its own job, TEACH-14),
 * so the Worksheet link is no longer part of this run. Stop is covered on a second lesson.
 */
import { expectNoSeriousA11yViolations } from "./a11y";
import { expect, test } from "./fixtures";

test.use({ seed: false });

test.describe("lesson generation over the fake worker", () => {
  test("brief → shell → slides arrive → editor unlocks in place with residuals", {
    tag: "@smoke",
  }, async ({ signedInPage: { page } }) => {
    await page.goto("/lessons/new");
    await page.getByRole("textbox", { name: "Topic", exact: true }).fill("States of matter");
    await page.getByRole("combobox", { name: "Year group" }).click();
    await page.getByRole("option", { name: "Year 8" }).click();
    // Skip planning is the one-job path this spec follows; planning first is `intake-live`.
    await page.getByRole("button", { name: "Skip planning" }).click();
    await expect(page).toHaveURL(/\/l\/[0-9a-f-]{36}$/);

    // The shell is up while the job plans: the strip, the stage line and one ghost Stop.
    const banner = page.getByTestId("generating-shell");
    await expect(banner).toBeVisible();
    await expect(page.getByTestId("generating-strip").locator("li")).toHaveCount(4);
    await expect(banner.getByRole("button", { name: "Stop" })).toBeVisible();
    // Greg 66 A: once the plan lands the filling editor opens in place, with no second bar. Every
    // slide the job has not finished is marked writing; the paced fake can finish first, so a
    // writing slide is not required, only that the editor follows the job to its end.
    await expect(
      page
        .locator("[data-filling-stop]")
        .or(page.getByRole("button", { name: "Rename lesson" }))
        .first(),
    ).toBeVisible({
      timeout: 20_000,
    });
    await expect(banner).toHaveCount(0);

    // The editor takes over in place — same URL, no reload — once the lock is released.
    await expect(page.getByRole("button", { name: "Rename lesson" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(banner).toHaveCount(0);
    await expect(page).toHaveURL(/\/l\/[0-9a-f-]{36}$/);
    const rail = page.getByRole("listbox", { name: "Slides" });
    await expect(rail.getByRole("option").first()).toBeVisible();
    // Editable: a text element on the canvas can be selected. Elements sit under the transform
    // layer's pointer catcher, so the click goes through the mouse at the element's centre.
    const text = page.locator('[data-slide-mode="edit"] [data-element-type="text"]').first();
    const box = await text.boundingBox();
    if (!box) throw new Error("no text element on the canvas");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByRole("toolbar", { name: "Text" })).toBeVisible();

    // The fake review's warning is the residual the footer lists (ADR 0025 §12).
    const footer = page.getByRole("button", { name: /thing(s)? to check$/ });
    await expect(footer).toBeVisible();
    await footer.click();
    await expect(page.getByRole("list").filter({ hasText: "diagram" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("Stop cancels the job; the partial lesson stays with a way back", { tag: "@smoke" }, async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons/new");
    // "held at review" (the e2e fake's `FAKE_HOLD_TOPIC`) keeps the job in its review until it is
    // cancelled, so Stop always lands on a running job instead of racing the paced run's end.
    await page
      .getByRole("textbox", { name: "Topic", exact: true })
      .fill("Forces and motion held at review");
    // Skip planning is the one-job path this spec follows; planning first is `intake-live`.
    await page.getByRole("button", { name: "Skip planning" }).click();
    await expect(page).toHaveURL(/\/l\/[0-9a-f-]{36}$/);
    const banner = page.getByTestId("generating-shell");
    // Let the job start before stopping it, so the cancel exercises the running path. Greg 66 A:
    // the filling editor opens once the plan lands, so Stop is the editor's.
    const stop = page.locator("[data-filling-stop]");
    await expect(stop).toBeVisible({ timeout: 20_000 });
    await stop.click();
    // Greg 60 A (UX-A): Stop keeps the teacher in the editor with every slide written so far and a
    // plain notice; nothing more is written, so there is no Try again.
    const notice = page.locator('[data-stopped-notice="cancelled"]');
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(notice).toContainText("Stopped. The slides written so far are here to edit.");
    await expect(notice.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await expect(banner).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Rename lesson" })).toBeVisible();
    const rail = page.getByRole("listbox", { name: "Slides" });
    await expect(rail.getByRole("option").first()).toBeVisible();
    await expectNoSeriousA11yViolations(page, "editor after Stop");
    await page.getByRole("button", { name: "Back to library" }).click();
    await expect(page).toHaveURL(/\/(lessons)?$/);
  });
});
