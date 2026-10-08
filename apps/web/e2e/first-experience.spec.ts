/**
 * `/dev/first-experience` (dev and preview builds): the creation flow over a local fixture that
 * paces slides with timers (`editor-preview.tsx`: the first after 2,600 ms, then one every
 * 2,400 ms, then 1,800 ms to ready) and a GSAP story. Tests that wait on that pacing install
 * Playwright's clock before the page loads and step it with `runFor`, which fires every timer and
 * animation frame on the way, instead of waiting in real time (TEACH-250).
 */
import { expect, type Locator, type Page, test } from "@playwright/test";

const PATH = "/dev/first-experience";
const FIRST_SLIDE_MS = 2_600;
const NEXT_SLIDE_MS = 2_400;

/**
 * Steps the fixture's pacing, one slide interval at a time, until the preview is ready. At most 20
 * intervals (48 s of story time); the fixture's eight slides are ready after about 19 s.
 */
async function runUntilReady(page: Page, preview: Locator) {
  for (let step = 0; step < 20; step++) {
    if ((await preview.getAttribute("data-preview-state")) === "ready") return;
    await page.clock.runFor(NEXT_SLIDE_MS);
  }
  await expect(preview).toHaveAttribute("data-preview-state", "ready");
}

async function openObjectives(page: Page) {
  await page.goto(PATH);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByTestId("creation-objectives")).toBeVisible();
}

async function openWorksheets(page: Page) {
  await openObjectives(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("creation-worksheet")).toBeVisible();
}

async function openGenerating(page: Page) {
  await openWorksheets(page);
  await page.getByRole("button", { name: "Just the slides" }).click();
  const preview = page.getByTestId("creation-generating");
  await expect(preview).toHaveAttribute("data-preview-state", "empty");
  return preview;
}

test.describe("first-experience design preview", () => {
  test("edits objectives, preserves them through Back, and can make several worksheets", async ({
    page,
  }) => {
    await openObjectives(page);
    await expect(page.getByRole("heading", { name: "Learning objectives" })).toBeFocused();

    const firstObjective = page.getByRole("textbox", { name: "Objective 1" });
    await firstObjective.fill("Explain how vibrations make sounds.");
    await page.getByRole("button", { name: "Add objective" }).click();
    await expect(page.getByRole("textbox", { name: "Objective 4" })).toBeVisible();
    await page.getByRole("textbox", { name: "Objective 4" }).fill("Compare two sound sources.");
    await page.getByRole("button", { name: "Remove objective 2" }).click();
    await expect(page.getByRole("textbox", { name: /^Objective / })).toHaveCount(3);

    await page.getByRole("button", { name: "Back to the brief" }).click();
    await expect(page.getByTestId("creation-brief")).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("textbox", { name: "Objective 1" })).toHaveValue(
      "Explain how vibrations make sounds.",
    );
    await expect(page.getByRole("textbox", { name: "Objective 3" })).toHaveValue(
      "Compare two sound sources.",
    );

    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Add a worksheet?" })).toBeFocused();
    const activityType = page.getByRole("combobox", { name: "Activity type" });
    await expect(activityType).toHaveCount(1);
    await expect(activityType).toHaveCSS("height", "48px");
    await expect(activityType).toHaveCSS("font-size", "16px");
    await expect(page.getByRole("combobox", { name: "Practice time" })).toHaveCount(1);

    await page.getByRole("button", { name: "Add another worksheet" }).click();
    await page.getByRole("button", { name: "Add another worksheet" }).click();
    await expect(page.getByRole("region", { name: /^Worksheet / })).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Include 3 worksheets" })).toBeVisible();
    await page.getByRole("button", { name: "Remove worksheet 2" }).click();
    await expect(page.getByRole("region", { name: /^Worksheet / })).toHaveCount(2);

    await page.getByRole("button", { name: "Include 2 worksheets" }).click();
    await expect(page.getByTestId("creation-generating")).toHaveAttribute(
      "data-preview-state",
      "empty",
    );
    await expect(page.getByText(/2 worksheets selected/)).toBeVisible();
  });

  test("Just the slides omits worksheets and Back returns to the objective choices", async ({
    page,
  }) => {
    await openWorksheets(page);
    await page.getByRole("button", { name: "Back to objectives" }).click();
    await expect(page.getByTestId("creation-objectives")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Slides" })).toContainText("8 slides");

    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Just the slides" }).click();
    await expect(page.getByTestId("creation-generating")).toHaveAttribute(
      "data-preview-state",
      "empty",
    );
    await expect(page.getByText(/worksheet selected/)).toHaveCount(0);
  });

  test("keyboard activation moves focus and reduced motion removes the entry animations", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(PATH);
    await expect(page.getByRole("heading", { name: "Let’s start with your idea." })).toBeFocused();
    await expect(page.getByTestId("creation-brief")).toHaveCSS("animation-name", "none");
    await expect(page.locator(".handover-stage")).toHaveAttribute("data-holder", "Plan");

    await page.getByRole("button", { name: "Next" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Learning objectives" })).toBeFocused();
    await expect(page.getByTestId("creation-objectives")).toHaveCSS("animation-name", "none");

    await page.getByRole("button", { name: "Continue" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Add a worksheet?" })).toBeFocused();
  });

  test("rapid navigation leaves one complete handover scene with one visible owner", async ({
    page,
  }) => {
    await page.clock.install();
    await page.goto(PATH);
    await page.getByRole("button", { name: "Skip planning" }).click();
    await expect(page.getByRole("combobox", { name: "Activity type" })).toBeEnabled();
    await page.getByRole("button", { name: "Back to objectives" }).click();
    await page.getByRole("button", { name: "Back to the brief" }).click();
    await page.getByRole("button", { name: "Skip planning" }).click();
    await expect(page.getByTestId("creation-worksheet")).toBeVisible();
    await page.clock.runFor(2_400);

    const scene = page.locator(".handover-stage .production-scene");
    await expect(scene).toHaveCount(1);
    await expect(scene.locator("#package, [id$='package']")).toHaveCount(1);
    const visibleOwners = await scene.locator(".person").evaluateAll(
      // Characters are never faded: an off-stage actor is hidden with `visibility`.
      (actors) => actors.filter((actor) => getComputedStyle(actor).visibility !== "hidden").length,
    );
    expect(visibleOwners).toBe(1);
  });

  test("reduced motion settles each handover immediately without duplicate props", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(PATH);
    await page.getByRole("button", { name: "Skip planning" }).click();
    await expect(page.getByRole("combobox", { name: "Activity type" })).toBeEnabled();
    await page.getByRole("button", { name: "Just the slides" }).click();
    await expect(page.getByTestId("creation-generating")).toHaveAttribute(
      "data-preview-state",
      "empty",
    );
    await expect(page.locator(".creation-generation-actor")).toHaveAttribute(
      "data-handover",
      "settled",
    );
    await expect(page.locator(".handover-stage")).toHaveAttribute("data-holder", "Slides");
    await expect(page.locator(".handover-stage")).toHaveCSS("animation-name", "none");
  });

  test("slides populate progressively, preserve selection, and hand over without a layout jump", async ({
    page,
  }) => {
    await page.clock.install();
    const preview = await openGenerating(page);
    const surface = page.locator(".creation-editor-surface");
    const before = await surface.boundingBox();
    if (!before) throw new Error("preview surface missing");

    const thumbs = page.getByRole("navigation", { name: "Slides" }).getByRole("button", {
      name: /^Slide \d+$/,
    });
    await expect(thumbs).toHaveCount(0);
    await page.clock.runFor(FIRST_SLIDE_MS);
    await expect(thumbs).toHaveCount(1);
    await page.clock.runFor(NEXT_SLIDE_MS);
    await expect(thumbs).toHaveCount(2);
    await thumbs.first().click();
    await expect(thumbs.first()).toHaveAttribute("aria-current", "true");
    const selectedId = await page.locator("[data-canvas-slide]").getAttribute("data-canvas-slide");
    expect(selectedId).toBeTruthy();

    await page.clock.runFor(NEXT_SLIDE_MS);
    await expect(thumbs).toHaveCount(3);
    await expect(thumbs.first()).toHaveAttribute("aria-current", "true");
    await expect(page.locator("[data-canvas-slide]")).toHaveAttribute(
      "data-canvas-slide",
      selectedId ?? "",
    );

    await runUntilReady(page, preview);
    await expect(page.getByRole("button", { name: "Rename lesson" })).toBeVisible();
    await expect(page.locator("[data-canvas] [data-slide-root]")).toHaveAttribute(
      "data-slide-id",
      selectedId ?? "",
    );
    const after = await surface.boundingBox();
    if (!after) throw new Error("editor surface missing");
    expect(Math.abs(after.width - before.width)).toBeLessThan(2);
    expect(Math.abs(after.height - before.height)).toBeLessThan(2);
  });

  test("Back and Start again unmount the local generation fixture", async ({ page }) => {
    await page.clock.install();
    await openGenerating(page);
    await page.getByRole("button", { name: "Start again" }).click();
    await expect(page.getByTestId("creation-brief")).toBeVisible();
    await page.clock.runFor(5_200);
    await expect(page.getByTestId("creation-generating")).toHaveCount(0);

    await openGenerating(page);
    await page.getByRole("button", { name: "Back to worksheets" }).click();
    await expect(page.getByTestId("creation-worksheet")).toBeVisible();
    await page.clock.runFor(5_200);
    await expect(page.getByTestId("creation-generating")).toHaveCount(0);
  });

  test("only the characters whose work was asked for appear: slides only is Slides' own entrance", async ({
    page,
  }) => {
    await page.clock.install();
    await openGenerating(page);
    const stage = page.locator(".creation-generation-actor .handover-stage");
    // Slides enters on its own (beat 12); Worksheet never comes on and nothing is handed over.
    await expect(stage).toHaveAttribute("data-beat", "12");
    await expect(stage).toHaveAttribute("data-holder", "Slides");
    // Every frame of the next 2 s of the story's time, played by the clock rather than waited out.
    // The sampler is in place (awaited) before the clock moves, so no early frame goes unseen.
    await stage.evaluate((root) => {
      const state = { seen: false, done: false };
      (window as unknown as { worksheetSeen: typeof state }).worksheetSeen = state;
      const end = performance.now() + 2_000;
      const look = () => {
        const worksheet = root.querySelector('[data-actor="2"]');
        if (worksheet && getComputedStyle(worksheet).visibility !== "hidden") {
          const figure = worksheet.querySelector(".figure");
          if (figure && getComputedStyle(figure).visibility !== "hidden") state.seen = true;
        }
        if (performance.now() < end) requestAnimationFrame(look);
        else state.done = true;
      };
      look();
    });
    await page.clock.runFor(2_000);
    const read = () =>
      page.evaluate(
        () =>
          (window as unknown as { worksheetSeen: { seen: boolean; done: boolean } }).worksheetSeen,
      );
    // The last sample is the first frame at or after the 2 s mark: step a frame or two more.
    for (let step = 0; step < 10 && !(await read()).done; step++) await page.clock.runFor(50);
    const sampled = await read();
    expect(sampled.done).toBe(true);
    expect(sampled.seen).toBe(false);
    await expect(stage).toHaveAttribute("data-beat", "3", { timeout: 4_000 });
  });

  test("a worksheet being made is handed to Slides by Worksheet", async ({ page }) => {
    await openWorksheets(page);
    await page.getByRole("button", { name: /^Include/ }).click();
    const stage = page.locator(".creation-generation-actor .handover-stage");
    await expect(stage).toHaveAttribute("data-beat", "8");
    await expect(stage).toHaveAttribute("data-holder", "Worksheet");
  });

  test("Check stays with the finished lesson until the teacher starts working", async ({
    page,
  }) => {
    // The clock plays about 30 s of story here frame by frame (to ready, then 8 s more); on a CI
    // runner shared by three workers that took over the default 30 s once (TEACH-190 part a).
    test.slow();
    await page.clock.install();
    const preview = await openGenerating(page);
    await runUntilReady(page, preview);
    await expect(page.getByRole("button", { name: "Rename lesson" })).toBeVisible();
    await page.clock.runFor(8_000);
    // The sign-off is done, but Check has not walked off on its own and its column is still there.
    await expect(page.locator(".creation-generation-actor")).toHaveCount(1);
    await expect(preview).toHaveAttribute("data-story-finished", "false");
    await page.locator("[data-canvas]").click();
    await expect(preview).toHaveAttribute("data-story-finished", "true");
    // Check walks off: play its exit on the clock rather than wait for it in real time.
    await page.clock.runFor(3_000);
    await expect(page.locator(".creation-generation-actor")).toHaveCount(0);
  });

  test("the selected-theme callout under the stage opens the picker and re-themes made and arriving slides", async ({
    page,
  }) => {
    await page.clock.install();
    const preview = await openGenerating(page);
    await page.clock.runFor(FIRST_SLIDE_MS);
    const callout = page.locator("[data-generating-theme] [data-theme-callout]");
    await expect(callout).toBeVisible();
    await expect(callout).toHaveText(/^Theme · /);
    // Nothing else opens the picker: no rail entry while the lesson is made.
    await expect(page.locator("[data-theme-callout]")).toHaveCount(1);
    const slideBg = () =>
      page
        .locator("[data-canvas] [data-slide-root]")
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor);
    await expect(page.locator("[data-canvas-slide]")).toBeVisible();
    const before = await slideBg();
    await callout.click();
    const dialog = page.getByRole("dialog", { name: "Theme" });
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-theme-tile="night-lab"]').click();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();
    await expect(callout).toHaveAttribute("data-theme-callout", "night-lab");
    await expect.poll(slideBg).not.toBe(before);
    const nightLab = await slideBg();
    await runUntilReady(page, preview);
    // Editable: the same callout sits in the top bar and the slide rail has none.
    const toolbar = page.locator("[data-topbar] [data-theme-callout]");
    await expect(toolbar).toBeVisible({ timeout: 5_000 });
    await expect(toolbar).toHaveAttribute("data-theme-callout", "night-lab");
    await expect(page.locator("[data-navigator] [data-theme-callout]")).toHaveCount(0);
    await expect.poll(slideBg).toBe(nightLab);
    await toolbar.click();
    await expect(page.getByRole("dialog", { name: "Theme" })).toBeVisible();
  });

  test("Cancel in the picker goes back to the theme the callout named", async ({ page }) => {
    await page.clock.install();
    await openGenerating(page);
    await page.clock.runFor(FIRST_SLIDE_MS);
    const callout = page.locator("[data-generating-theme] [data-theme-callout]");
    await expect(callout).toBeVisible();
    const opening = await callout.getAttribute("data-theme-callout");
    const other = opening === "night-lab" ? "playground" : "night-lab";
    await callout.click();
    const dialog = page.getByRole("dialog", { name: "Theme" });
    await dialog.locator(`[data-theme-tile="${other}"]`).click();
    await expect(callout).toHaveAttribute("data-theme-callout", other);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(callout).toHaveAttribute("data-theme-callout", opening ?? "");
  });

  test("on a phone the callout is visible under the slides and in the top bar, never in More", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.install();
    const preview = await openGenerating(page);
    await page.clock.runFor(FIRST_SLIDE_MS);
    const callout = page.locator("[data-generating-theme] [data-theme-callout]");
    await expect(callout).toBeVisible();
    const box = await callout.boundingBox();
    if (!box) throw new Error("theme callout missing");
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await callout.click();
    const dialog = page.getByRole("dialog", { name: "Theme" });
    await expect(dialog.locator("[data-theme-tile]")).toHaveCount(10);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await runUntilReady(page, preview);
    const toolbar = page.locator("[data-topbar] [data-theme-callout]");
    await expect(toolbar).toBeVisible({ timeout: 5_000 });
    const bar = await toolbar.boundingBox();
    if (!bar) throw new Error("top bar callout missing");
    expect(bar.x + bar.width).toBeLessThanOrEqual(390);
    await page.getByRole("button", { name: "More lesson actions" }).click();
    await expect(page.getByRole("dialog", { name: "Lesson actions" })).not.toContainText("Theme");
  });

  test("long objectives grow on mobile without losing focus or overflowing", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openObjectives(page);
    const objective = page.getByRole("textbox", { name: "Objective 1" });
    await objective.focus();
    const initialHeight = await objective.evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    await objective.fill(
      "Explain how vibrations make sounds and compare how those vibrations travel through solids, liquids and gases using precise scientific evidence.",
    );
    await expect(objective).toBeFocused();
    const box = await objective.boundingBox();
    if (!box) throw new Error("objective missing");
    expect(box.height).toBeGreaterThan(initialHeight);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  });
});
