import { expect, test } from "./fixtures";

test.use({ seed: false });

async function reachObjectives(page: import("@playwright/test").Page, topic: string) {
  await page.goto("/lessons/new");
  await page.getByRole("textbox", { name: "Topic" }).fill(topic);
  await page.getByRole("combobox", { name: "Year group" }).click();
  await page.getByRole("option", { name: "Year 5" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/\/lessons\/new\?lesson=[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Planning your lesson" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Learning objectives" })).toBeVisible({
    timeout: 35_000,
  });
}

test.describe("real lesson intake over the fake worker", () => {
  test("plans, confirms objectives, includes a worksheet, and reaches the real editor", async ({
    signedInPage: { page },
  }) => {
    test.setTimeout(100_000);
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));

    await page.setViewportSize({ width: 1366, height: 768 });
    await reachObjectives(page, "States of matter and the particle model");
    await expect(page.getByRole("textbox", { name: /^Objective / })).not.toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Slides" })).toContainText("8 slides");
    await expect(page.getByRole("combobox", { name: "Lesson length" })).toHaveCount(0);

    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Add a worksheet?" })).toBeVisible();
    await page.getByRole("button", { name: "Include worksheet" }).click();
    await expect(page).toHaveURL(/\/l\/[0-9a-f-]{36}$/);
    const generationStatus = page.locator(".creation-generation-status");
    await expect(generationStatus).toContainText(/Making your slides|Checking your slides/, {
      timeout: 15_000,
    });
    await page.screenshot({ path: "/tmp/live-intake-generating-desktop.png" });

    await expect(page.getByRole("button", { name: "Rename lesson" })).toBeVisible({
      timeout: 50_000,
    });
    await expect(page.getByRole("button", { name: "Worksheets", exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: "/tmp/live-intake-editor-desktop.png" });

    await page.getByRole("button", { name: "Rename lesson" }).click();
    const title = page.getByRole("textbox", { name: "Lesson title" });
    await title.fill("States of matter — ready to teach");
    await title.blur();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });

    const worksheetsResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        /\/lessons\/[0-9a-f-]{36}\/worksheets$/.test(response.url()) &&
        response.status() === 200,
    );
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "States of matter — ready to teach" }),
    ).toBeVisible();
    const worksheets = (await (await worksheetsResponse).json()) as {
      items: Array<{
        id: string;
        generatingJobId: string | null;
        generation?: { completedAt?: string };
      }>;
    };
    expect(worksheets.items).toHaveLength(1);
    expect(worksheets.items[0]?.generatingJobId).toBeNull();
    expect(worksheets.items[0]?.generation?.completedAt).toBeTruthy();

    await page.getByRole("button", { name: "Worksheets", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Worksheets" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Ready", { exact: true })).toHaveCount(1);
    expect(runtimeErrors).toEqual([]);
  });

  test("can skip the optional worksheet and use the generated editor on mobile", async ({
    signedInPage: { page },
  }) => {
    test.setTimeout(80_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await reachObjectives(page, "States of matter and the particle model");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Just the slides" }).click();

    await expect(page).toHaveURL(/\/l\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("button", { name: "Rename lesson" })).toBeVisible({
      timeout: 50_000,
    });
    await expect(page.locator("[data-mobile-lesson-list]")).toBeVisible();
    await expect(page.getByText("Slides ready", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-save-state="saved"]')).toBeAttached();
    await expect(page.locator(".handover-stage")).toHaveCount(0, { timeout: 45_000 });
    await page.screenshot({ path: "/tmp/live-intake-editor-mobile.png", fullPage: true });
  });
});
