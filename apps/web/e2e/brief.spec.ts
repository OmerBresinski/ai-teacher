/**
 * The lesson brief (F01 item 2, TEACH-122): from the library's New lesson to `/l/:id`. The e2e
 * worker has no Bedrock token (or a developer's has one and spends real money), so the spec
 * asserts the hand-over to the lesson page and the request shape, not a finished deck.
 */
import { expect, test } from "./fixtures";

test.use({ seed: false });

test.describe("lesson brief", () => {
  test("New lesson opens the brief inside the shell with the topic focused", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons");
    await page.getByRole("button", { name: "New lesson" }).click();
    await expect(page).toHaveURL(/\/lessons\/new$/);
    await expect(page).toHaveTitle("New lesson · Teaching Journey");
    await expect(page.getByRole("navigation", { name: "Library" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Topic or objective" })).toBeFocused();
    await expect(page.getByRole("button", { name: "Create lesson" })).toBeDisabled();
    await expect(page.getByRole("tab", { name: /coming soon/ })).toBeDisabled();
  });

  test("topic and year group are enough: defaults, questions, POST /lessons, then the lesson page", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons/new");
    const topic = page.getByRole("textbox", { name: "Topic or objective" });
    await topic.fill("Fractions of amounts");
    await page.getByRole("combobox", { name: "Year group" }).click();
    await page.getByRole("option", { name: "Year 5" }).click();

    const duration = page.getByRole("spinbutton", { name: "Duration (minutes)" });
    await expect(duration).toHaveAttribute("placeholder", "60");
    await expect(page.getByRole("button", { name: "Create lesson" })).toBeEnabled();
    await expect(page.getByRole("radio", { name: "Recall fractions of amounts" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "New to it" })).toBeChecked();

    const posted = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith("/lessons"),
    );
    await page.getByRole("button", { name: "Create lesson" }).click();
    const request = await posted;
    expect(request.postDataJSON()).toEqual({
      brief: {
        topic: "Fractions of amounts",
        answers: {
          objectiveVerb: "Recall fractions of amounts",
          priorConfidence: "New to it",
        },
      },
      yearGroup: "Year 5",
      themeId: "chalk",
    });
    const response = await request.response();
    expect(response?.status()).toBe(202);

    await expect(page).toHaveURL(/\/l\/[0-9a-f-]{36}$/);
    // Either the job still holds the lock (banner) or it has already ended (the page's empty or
    // editor state); the title is on screen in every case.
    await expect(page.getByText("Fractions of amounts").first()).toBeVisible({ timeout: 15_000 });
    await expect(
      page
        .getByTestId("generating-banner")
        .or(page.getByText("This lesson has no slides yet"))
        .or(page.getByRole("button", { name: "Rename lesson" }))
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("skipping both questions posts no answers; the guard blocks a pupil reference", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons/new");
    await page.getByRole("textbox", { name: "Topic or objective" }).fill("The water cycle");
    // Each Skip becomes "Answer" once pressed, so the first remaining Skip is clicked twice.
    await page.getByRole("button", { name: "Skip" }).first().click();
    await page.getByRole("button", { name: "Skip" }).first().click();
    await expect(page.getByText("Skipped — the plan decides.")).toHaveCount(2);
    await page.getByRole("spinbutton", { name: "Duration (minutes)" }).fill("45");

    await page.getByRole("button", { name: "Add class context" }).click();
    const notes = page.getByRole("textbox", { name: "Notes" });
    await notes.fill("A pupil called Jamie struggles");
    await notes.blur();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Remove pupil names or identifiers before saving.");
    await expect(alert.locator("mark")).toHaveText("pupil called");
    await expect(page.getByRole("button", { name: "Create lesson" })).toBeDisabled();
    await notes.fill("Lively after lunch");
    await expect(page.getByRole("button", { name: "Create lesson" })).toBeEnabled();

    const posted = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith("/lessons"),
    );
    await page.getByRole("button", { name: "Create lesson" }).click();
    expect((await posted).postDataJSON()).toEqual({
      brief: {
        topic: "The water cycle",
        durationMin: 45,
        classContext: { notes: "Lively after lunch" },
      },
      themeId: "chalk",
    });
    await expect(page).toHaveURL(/\/l\/[0-9a-f-]{36}$/);
  });
});
