import type { Page } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "./a11y";
import { expect, type SeededPaths, test } from "./fixtures";

/*
 * The worksheet creation flow (TEACH-184): Source then Kind at `/worksheets/new`. Rows 1, 2, 4,
 * 5 and 6 of the acceptance table, with the Practise filter, the tier row and the keyboard path
 * beside them. The seeded water cycle lesson carries facts, so its miniatures show its
 * vocabulary and questions and Suggested lands on Misconception check.
 */

const kinds = (page: Page) => page.getByRole("list", { name: "Kinds" }).locator(":scope > li");
const continueButton = (page: Page) => page.getByRole("button", { name: "Continue" });

async function openKindForWaterCycle(page: Page): Promise<void> {
  await page.goto("/worksheets/new");
  await page.getByRole("button", { name: /^The water cycle\./ }).click();
  await continueButton(page).click();
  await expect(page.locator('[data-create-step="kind"]')).toBeVisible();
  await expect(kinds(page)).toHaveCount(9);
}

test.describe("worksheet creation", () => {
  test("row 1: New worksheet opens Source with recent lessons and Blank", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/worksheets");
    await page.getByRole("button", { name: "New worksheet" }).click();
    await expect(page).toHaveURL(/\/worksheets\/new$/);
    await expect(page).toHaveTitle("New worksheet · Teaching Journey");
    await expect(page.getByRole("heading", { level: 1, name: "New worksheet" })).toBeVisible();
    const lessons = page.getByRole("list", { name: "Recent lessons" }).locator(":scope > li");
    await expect(lessons).toHaveCount(10);
    await expect(
      page.getByRole("button", { name: /^The water cycle\. Year 4 Science/ }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^Blank/ })).toBeVisible();
    // Nothing chosen: the primary is off and says why.
    await expect(continueButton(page)).toBeDisabled();
    await expect(page.getByText("Choose a lesson or Blank.")).toBeVisible();
    await page.getByRole("searchbox", { name: "Search lessons" }).fill("roman");
    await expect(lessons).toHaveCount(3);
    await expectNoSeriousA11yViolations(page, "/worksheets/new (Source)");
  });

  test("row 2: the water cycle's Kind shows nine live miniatures, Suggested and minutes; Practise leaves three", async ({
    signedInPage: { page },
  }) => {
    await openKindForWaterCycle(page);
    await expect(page.locator('[data-create-step="kind"]')).toHaveAttribute("data-facts", "lesson");
    await expect(page.locator("[data-example-facts-hint]")).toHaveCount(0);
    await expect(page.locator(".ws-mini .ws-page")).toHaveCount(9);
    await expect(page.getByText(/^about \d+ min$/)).toHaveCount(9);
    // The miniatures are the lesson's own facts: its vocabulary, its questions, its header.
    const cloze = page.locator('[data-recipe="cloze"]');
    await expect(cloze).toContainText("evaporation");
    await expect(cloze.locator(".ws-mini .ws-title")).toHaveText("The water cycle");
    await expect(page.locator('[data-recipe="exit-ticket"]')).toContainText(
      "What is the name for liquid water turning into a gas?",
    );
    const suggested = page.getByText("Suggested", { exact: true });
    await expect(suggested).toHaveCount(1);
    await expect(page.locator('[data-recipe="misconception-check"]')).toContainText("Suggested");
    // The suggestion is selected until a card is picked.
    await expect(
      page.locator('[data-recipe="misconception-check"] .ws-recipe-pick'),
    ).toHaveAttribute("aria-pressed", "true");
    // Row 7: the tier row.
    await expect(page.locator('[data-tier="core"]')).toHaveAttribute("data-selected", "true");
    await expect(page.locator('button[data-tier="core"]')).toHaveCount(0);
    await expect(page.locator('[data-tier="support"]')).toBeDisabled();
    await expect(page.locator('[data-tier="challenge"]')).toBeDisabled();
    await expect(page.getByText("Support and Challenge: arrive with generation.")).toBeVisible();
    await expectNoSeriousA11yViolations(page, "/worksheets/new (Kind)");

    // Row 3: Practise.
    await page.getByRole("button", { name: "Practise", exact: true }).click();
    await expect(kinds(page)).toHaveCount(3);
    await expect(page.locator('[data-recipe="cloze"]')).toBeVisible();
    await expect(page.locator('[data-recipe="matching"]')).toBeVisible();
    await expect(page.locator('[data-recipe="worked-example"]')).toBeVisible();
    // The suggestion is hidden by the chip, so nothing is chosen and Continue says so.
    await expect(continueButton(page)).toBeDisabled();
    await expect(page.getByText("Choose a kind of sheet.")).toBeVisible();
    await page.getByRole("button", { name: "Practise", exact: true }).click();
    await expect(kinds(page)).toHaveCount(9);
  });

  test("row 4: Exit ticket, Continue: the editor opens on the lesson's sheet with the frame and its lesson", async ({
    signedInPage: { page },
  }) => {
    await openKindForWaterCycle(page);
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
    // The exit ticket frame: three questions, the answer box, the placeholder.
    await expect(page.locator(".ws-column .ws-block")).toHaveCount(5);
    await expect(page.locator(".ws-column")).toContainText("One thing I learned");
    await expect(page.locator(".ws-column .ws-objective")).toHaveText(
      "Name the four stages of the water cycle in order.",
    );
    // The whole frame is the initial state: nothing to undo.
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
    // `lessonId` is set: Add block builds its sections from this lesson.
    await page.getByRole("button", { name: "Add block" }).click();
    await expect(page.getByRole("dialog", { name: "Add a block" })).toContainText(
      "Sections are built from this lesson.",
    );
  });

  test("row 5: the lesson editor's Worksheet action opens Kind for that lesson", async ({
    signedInPage: { page, paths },
  }) => {
    await page.goto(paths.lesson("demo-water-cycle"));
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.locator("[data-topbar] [data-new-worksheet]").click();
    await expect(page).toHaveURL(
      new RegExp(`/worksheets/new\\?lesson=${paths.id("demo-water-cycle")}$`),
    );
    await expect(page.locator('[data-create-step="kind"]')).toBeVisible();
    await expect(page.getByText("For The water cycle.")).toBeVisible();
    await expect(kinds(page)).toHaveCount(9);
    // Row 8: Escape returns to Source with the lesson still chosen.
    await page.locator('[data-recipe="cloze"] .ws-recipe-pick').focus();
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-create-step="source"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /^The water cycle\./ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Enter on a card continues.
    await page.getByRole("button", { name: /^The water cycle\./ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-create-step="kind"]')).toBeVisible();
  });

  test("row 8: Enter on an unselected card chooses and continues in one press; Enter on Blank after a lesson goes Blank", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/worksheets/new");
    // One press on a card nothing has chosen yet.
    await page.getByRole("button", { name: /^Roman roads\./ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-create-step="kind"]')).toBeVisible();
    await expect(page.getByText("For Roman roads.")).toBeVisible();
    // Back, then Blank by keyboard while the lesson is still the chosen source.
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-create-step="source"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /^Roman roads\./ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: /^Blank/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/w\/[^/]+$/);
    await expect(
      page.locator("[data-topbar]").getByRole("heading", { level: 1, name: "Untitled worksheet" }),
    ).toBeVisible();
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
    await expect(row).toContainText("6 marks · 10 min");
  });

  test("a lesson without facts says its miniatures are built from example facts", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/worksheets/new");
    await page.getByRole("button", { name: /^Roman roads\./ }).click();
    await continueButton(page).click();
    await expect(page.locator('[data-create-step="kind"]')).toHaveAttribute(
      "data-facts",
      "example",
    );
    await expect(page.locator("[data-example-facts-hint]")).toHaveText(
      "Built from example facts until this lesson has its own",
    );
    // The header is this lesson's, not the example lesson's.
    await expect(page.locator('[data-recipe="cloze"] .ws-mini .ws-title')).toHaveText(
      "Roman roads",
    );
    await expect(page.locator('[data-recipe="knowledge-check"]')).toContainText("Suggested");
  });
});

export type { SeededPaths };
