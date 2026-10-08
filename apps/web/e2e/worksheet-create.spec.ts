import type { Page } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "./a11y";
import { expect, type SeededPaths, test } from "./fixtures";

/*
 * The worksheet creation flow (TEACH-184): Source then Kind at `/worksheets/new`. Rows 4 and 6 of
 * the acceptance table end in the real editor, and row 4 carries the axe scans of both steps. The
 * steps themselves (rows 1, 2, 5 and 8, the example-facts hint) are unit tests in
 * `src/routes/worksheet-create.page.test.tsx` (TEACH-301).
 */

const kinds = (page: Page) => page.getByRole("list", { name: "Kinds" }).locator(":scope > li");
const continueButton = (page: Page) => page.getByRole("button", { name: "Continue" });

test.describe("worksheet creation", () => {
  test("row 4: Exit ticket, Continue: the editor opens on the lesson's sheet with the frame and its lesson", {
    tag: "@smoke",
  }, async ({ signedInPage: { page } }) => {
    // Source and Kind are scanned here; their other checks are unit tests (TEACH-301).
    await page.goto("/worksheets/new");
    await expect(page).toHaveTitle("New worksheet · DayBack");
    await expect(page.getByRole("button", { name: /^The water cycle\./ })).toBeVisible();
    await expectNoSeriousA11yViolations(page, "/worksheets/new (Source)");
    await page.getByRole("button", { name: /^The water cycle\./ }).click();
    await continueButton(page).click();
    await expect(page.locator('[data-create-step="kind"]')).toBeVisible();
    await expect(kinds(page)).toHaveCount(9);
    await expectNoSeriousA11yViolations(page, "/worksheets/new (Kind)");
    await page.getByRole("button", { name: /^Exit ticket\./ }).click();
    await expect(page.locator('[data-recipe="exit-ticket"] .ws-recipe-pick')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await continueButton(page).click();
    await expect(page).toHaveURL(/\/w\/[^/]+$/);
    await expect(
      page.locator("[data-topbar]").getByRole("heading", { level: 1, name: "The water cycle" }),
    ).toBeVisible();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    // The exit ticket frame: the instruction line, three questions, the answer box, the placeholder.
    await expect(page.locator(".ws-column .ws-block")).toHaveCount(6);
    await expect(page.locator(".ws-column .ws-instructions").first()).toHaveText(
      "Answer each question in one or two sentences.",
    );
    await expect(page.locator(".ws-column")).toContainText("One thing I learned");
    await expect(page.locator(".ws-column .ws-objective")).toHaveText(
      "I can name the four stages of the water cycle in order.",
    );
    // The whole frame is the initial state: nothing to undo.
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
    // `lessonId` is set: Add block builds its sections from this lesson.
    await page.getByRole("button", { name: "Add block" }).click();
    await expect(page.getByRole("dialog", { name: "Add a block" })).toContainText(
      "Sections are built from this lesson.",
    );
  });

  test("row 6: Blank, Continue: the starter sheet with the class from the last brief", async ({
    signedInPage: { page },
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem(
        "tj:brief:last-class",
        JSON.stringify({
          subject: "Science",
          subjectOther: "",
          yearGroup: "Year 4",
          themeId: "chalk",
        }),
      ),
    );
    await page.goto("/worksheets/new");
    const blank = page.getByRole("button", { name: /^Blank/ });
    await expect(blank).toContainText("Year 4 Science, from your last lesson.");
    await blank.click();
    await continueButton(page).click();
    await expect(page).toHaveURL(/\/w\/[^/]+$/);
    await expect(
      page.locator("[data-topbar]").getByRole("heading", { level: 1, name: "Untitled worksheet" }),
    ).toBeVisible();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect(page.locator(".ws-column .ws-block")).toHaveCount(5);
    await page.getByRole("button", { name: "Back to library" }).click();
    await page.getByRole("link", { name: /^Worksheets\b/ }).click();
    await page.getByRole("button", { name: "List" }).click();
    const row = page.getByRole("row", { name: /Untitled worksheet/ });
    await expect(row).toContainText("Year 4 Science");
    await expect(row).toContainText("10 min");
  });
});

export type { SeededPaths };
