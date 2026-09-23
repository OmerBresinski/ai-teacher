import { expect, test } from "@playwright/test";

const PATH = "/dev/first-experience";

async function openObjectives(page: import("@playwright/test").Page) {
  await page.goto(PATH);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByTestId("creation-objectives")).toBeVisible();
}

async function openWorksheets(page: import("@playwright/test").Page) {
  await openObjectives(page);
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByTestId("creation-worksheet")).toBeVisible();
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

    await page.getByRole("button", { name: "Generate" }).click();
    await expect(page.getByRole("heading", { name: "Something to practise with?" })).toBeFocused();
    const activityType = page.getByRole("combobox", { name: "Activity type" });
    await expect(activityType).toHaveCount(1);
    await expect(activityType).toHaveCSS("height", "48px");
    await expect(activityType).toHaveCSS("font-size", "16px");
    await expect(page.getByRole("combobox", { name: "Practice time" })).toHaveCount(1);

    await page.getByRole("button", { name: "Add another worksheet" }).click();
    await page.getByRole("button", { name: "Add another worksheet" }).click();
    await expect(page.getByRole("region", { name: /^Worksheet / })).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Make 3 worksheets" })).toBeVisible();
    await page.getByRole("button", { name: "Remove worksheet 2" }).click();
    await expect(page.getByRole("region", { name: /^Worksheet / })).toHaveCount(2);

    await page.getByRole("button", { name: "Make 2 worksheets" }).click();
    await expect(page.getByTestId("creation-generating")).toBeVisible();
    await expect(page.getByText(/^Worksheet [12]$/)).toHaveCount(2);
    await expect(page.getByText("Animation preview — no lesson is being generated.")).toBeVisible();
  });

  test("Just the slides omits worksheets and Back returns to the objective choices", async ({
    page,
  }) => {
    await openWorksheets(page);
    await page.getByRole("button", { name: "Back to objectives" }).click();
    await expect(page.getByTestId("creation-objectives")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Slides" })).toContainText("8 slides");

    await page.getByRole("button", { name: "Generate" }).click();
    await page.getByRole("button", { name: "Just the slides" }).click();
    await expect(page.getByTestId("creation-generating")).toBeVisible();
    await expect(page.getByText("Slides", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Worksheet \d+$/)).toHaveCount(0);
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

    await page.getByRole("button", { name: "Generate" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Something to practise with?" })).toBeFocused();
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
    await expect(page.getByRole("button", { name: "Back to worksheets" })).toBeEnabled();

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
});
