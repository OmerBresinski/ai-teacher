/**
 * TEACH-133: a lesson generated end to end over the fake worker (`AI_FAKE_SCRIPT=pipeline`, paced
 * 250 ms per model answer, ADR 0025 §22). From the brief screen to `/l/$lessonId`: the generating
 * shell and its stage strip, slides arriving before the job ends (the `documentUpdatedAt`
 * refetch, §7), the editor taking over in place with no reload, the residual entry fed by the fake review's warning (§12)
 * and the Worksheet link to the generated sheet (§4). Stop is covered on a second lesson.
 */
import { expectNoSeriousA11yViolations } from "./a11y";
import { expect, test } from "./fixtures";

test.use({ seed: false });

test.describe("lesson generation over the fake worker", () => {
  test("brief → shell → slides arrive → editor unlocks in place with residuals and a worksheet", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons/new");
    await page.getByRole("textbox", { name: "Topic or objective" }).fill("States of matter");
    await page.getByRole("combobox", { name: "Year group" }).click();
    await page.getByRole("option", { name: "Year 8" }).click();
    await page.getByRole("button", { name: "Plan it" }).click();
    await expect(page).toHaveURL(/\/l\/[0-9a-f-]{36}$/);

    // The shell is up while the job runs: the strip, the stage line and one ghost Stop.
    const banner = page.getByTestId("generating-shell");
    await expect(banner).toBeVisible();
    await expect(page.getByTestId("generating-strip").locator("li")).toHaveCount(5);
    await expect(banner.getByRole("button", { name: "Stop" })).toBeVisible();
    // Planning ticks and Writing goes live as the first content slide lands.
    await expect(page.getByTestId("generating-stage")).toContainText(/Writing the slides/, {
      timeout: 20_000,
    });
    await expect(page.locator('[data-stage="planning"]')).toHaveAttribute("data-status", "done");

    // Slides appear one by one: the count grows at least once before the terminal event.
    const slides = page.locator("[data-slide-root]");
    await expect.poll(() => slides.count(), { timeout: 20_000 }).toBeGreaterThan(0);
    const early = await slides.count();
    await expect
      .poll(
        async () => ((await banner.count()) === 0 ? Number.POSITIVE_INFINITY : slides.count()),
        {
          timeout: 20_000,
        },
      )
      .toBeGreaterThan(early);

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

    // The generated worksheet is one click away.
    await page.getByRole("button", { name: "Worksheet" }).click();
    await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}$/);
  });

  test("Stop cancels the job; the partial lesson stays with a way back", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons/new");
    await page.getByRole("textbox", { name: "Topic or objective" }).fill("Forces and motion");
    await page.getByRole("button", { name: "Plan it" }).click();
    await expect(page).toHaveURL(/\/l\/[0-9a-f-]{36}$/);
    const banner = page.getByTestId("generating-shell");
    // Let the job start before stopping it, so the cancel exercises the running path: the title
    // slide is the first persist, so its thumb means the worker has the job.
    await expect(banner.locator("[data-slide-thumb]").first()).toBeVisible({ timeout: 20_000 });
    await banner.getByRole("button", { name: "Stop" }).click();
    await expect(banner).toHaveAttribute("data-state", "cancelled", { timeout: 20_000 });
    await expect(page.getByTestId("generating-stage")).toHaveText("Generation stopped.");
    await expect(page.getByTestId("generating-lock")).toHaveText(
      "Stopped. What was written is kept.",
    );
    await expect(banner.getByRole("button", { name: "Stop" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Rename lesson" })).toHaveCount(0);
    await expectNoSeriousA11yViolations(page, "generating shell (cancelled)");
    await banner.getByRole("button", { name: "Back to library" }).click();
    await expect(page).toHaveURL(/\/(lessons)?$/);
  });
});
