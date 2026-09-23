import { expect, test } from "@playwright/test";

const PATH = "/dev/first-experience";

async function openObjectives(page: import("@playwright/test").Page) {
  await page.goto(PATH);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByTestId("creation-objectives")).toBeVisible();
}

async function openWorksheets(page: import("@playwright/test").Page) {
  await openObjectives(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("creation-worksheet")).toBeVisible();
}

async function openGenerating(page: import("@playwright/test").Page) {
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
    await expect(page.getByRole("combobox", { name: "Slides" })).toContainText("7 slides");

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
    await page.goto(PATH);
    await page.getByRole("button", { name: "Skip planning" }).click();
    await expect(page.getByRole("combobox", { name: "Activity type" })).toBeEnabled();
    await page.getByRole("button", { name: "Back to objectives" }).click();
    await page.getByRole("button", { name: "Back to the brief" }).click();
    await page.getByRole("button", { name: "Skip planning" }).click();
    await expect(page.getByTestId("creation-worksheet")).toBeVisible();
    await page.waitForTimeout(2_400);

    const scene = page.locator(".handover-stage .production-scene");
    await expect(scene).toHaveCount(1);
    await expect(scene.locator("#package, [id$='package']")).toHaveCount(1);
    const visibleOwners = await scene
      .locator(".person")
      .evaluateAll(
        (actors) =>
          actors.filter((actor) => Number.parseFloat(getComputedStyle(actor).opacity) > 0.05)
            .length,
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
    test.setTimeout(40_000);
    const preview = await openGenerating(page);
    const surface = page.locator(".creation-editor-surface");
    const before = await surface.boundingBox();
    if (!before) throw new Error("preview surface missing");

    const thumbs = page.getByRole("navigation", { name: "Slides" }).getByRole("button", {
      name: /^Slide \d+$/,
    });
    await expect(thumbs).toHaveCount(0);
    await expect(thumbs).toHaveCount(1, { timeout: 7_000 });
    await expect(thumbs).toHaveCount(2, { timeout: 4_000 });
    await thumbs.first().click();
    await expect(thumbs.first()).toHaveAttribute("aria-current", "true");
    const selectedId = await page.locator("[data-canvas-slide]").getAttribute("data-canvas-slide");
    expect(selectedId).toBeTruthy();

    await expect(thumbs).toHaveCount(3, { timeout: 4_000 });
    await expect(thumbs.first()).toHaveAttribute("aria-current", "true");
    await expect(page.locator("[data-canvas-slide]")).toHaveAttribute(
      "data-canvas-slide",
      selectedId ?? "",
    );

    await expect(preview).toHaveAttribute("data-preview-state", "ready", { timeout: 25_000 });
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
    test.setTimeout(20_000);
    await openGenerating(page);
    await page.getByRole("button", { name: "Start again" }).click();
    await expect(page.getByTestId("creation-brief")).toBeVisible();
    await page.waitForTimeout(5_200);
    await expect(page.getByTestId("creation-generating")).toHaveCount(0);

    await openGenerating(page);
    await page.getByRole("button", { name: "Back to worksheets" }).click();
    await expect(page.getByTestId("creation-worksheet")).toBeVisible();
    await page.waitForTimeout(5_200);
    await expect(page.getByTestId("creation-generating")).toHaveCount(0);
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
