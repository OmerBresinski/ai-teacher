/**
 * The lesson brief (F01 item 2, TEACH-122; TEACH-177): from the library's New lesson to `/l/:id`.
 * The e2e worker has no Bedrock token (or a developer's has one and spends real money), so the
 * spec asserts the hand-over to the lesson page and the request shape, not a finished deck.
 */
import { expect, test } from "./fixtures";
import { MATERIAL, tinyPdf } from "./source-fixtures";

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
    const planIt = page.getByRole("button", { name: "Plan it" });
    await expect(planIt).toBeDisabled();
    await expect(page.getByRole("status")).toHaveText("Type a topic to plan the lesson.");
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Blank lesson" })).toBeVisible();
    // Nothing stored: the class selects read "Not set" with no hint.
    await expect(page.getByRole("combobox", { name: "Subject" })).toHaveText("Not set");
    await expect(page.getByText("From your last lesson")).toHaveCount(0);
    // Six theme tiles are one radio group; arrow keys move the choice.
    const tiles = page.getByTestId("theme-tiles").getByRole("radio");
    await expect(tiles).toHaveCount(6);
    await expect(page.getByRole("radio", { name: "Chalk & Cream" })).toBeChecked();
    await page.getByRole("radio", { name: "Chalk & Cream" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "Playground" })).toBeChecked();
    await expect(page.getByTestId("theme-tiles").locator("[data-slide-fluid]")).toHaveCount(6);
  });

  test("the action bar stays in view at any scroll; a bad duration says why the primary is off", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons/new");
    await page.getByRole("textbox", { name: "Topic or objective" }).fill("The water cycle");
    await page.getByRole("button", { name: "Add class context" }).click();
    const planIt = page.getByRole("button", { name: "Plan it" });
    await expect(planIt).toBeEnabled();
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(planIt).toBeInViewport();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(planIt).toBeInViewport();

    await page.getByRole("spinbutton", { name: "Duration (minutes)" }).fill("3");
    await expect(planIt).toBeDisabled();
    await expect(page.getByRole("status")).toHaveText(
      "Duration must be between 5 and 180 minutes.",
    );
    await page.getByRole("spinbutton", { name: "Duration (minutes)" }).fill("30");
    await expect(planIt).toBeEnabled();
    await expect(page.getByRole("status")).toHaveCount(0);
  });

  test("questions come one at a time with the suggestion marked; Enter accepts, Skip stays", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons/new");
    await page.getByRole("textbox", { name: "Topic or objective" }).fill("the water cycle");
    const explain = page.getByRole("radio", { name: "Explain" });
    await expect(explain).toBeChecked();
    await expect(explain).toHaveAccessibleDescription(/suggested/);
    await expect(page.getByText("suggested", { exact: true })).toBeVisible();
    await expect(page.getByRole("radio", { name: "New to it" })).toHaveCount(0);

    await explain.press("Enter");
    await expect(page.getByTestId("question-objectiveVerb-done")).toContainText("Explain");
    const newToIt = page.getByRole("radio", { name: "New to it" });
    await expect(newToIt).toBeChecked();
    await expect(newToIt).toBeFocused();
    await page.getByRole("button", { name: "Skip" }).click();
    await expect(page.getByTestId("question-priorConfidence-done")).toContainText(
      "Skipped — the plan decides.",
    );
    await expect(page.getByRole("button", { name: "Plan it" })).toBeFocused();

    const posted = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith("/lessons"),
    );
    await page.getByRole("button", { name: "Plan it" }).click();
    expect((await posted).postDataJSON()).toEqual({
      brief: { topic: "the water cycle", answers: { objectiveVerb: "Explain the water cycle" } },
      themeId: "chalk",
    });
  });

  test("topic, subject and year are enough: defaults, questions, POST /lessons, the lesson page, then the class is remembered", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons/new");
    const topic = page.getByRole("textbox", { name: "Topic or objective" });
    await topic.fill("Fractions of amounts");
    await page.getByRole("combobox", { name: "Subject" }).click();
    await page.getByRole("option", { name: "Science" }).click();
    await page.getByRole("combobox", { name: "Year group" }).click();
    await page.getByRole("option", { name: "Year 5" }).click();

    const duration = page.getByRole("spinbutton", { name: "Duration (minutes)" });
    await expect(duration).toHaveAttribute("placeholder", "60");
    await expect(page.getByRole("button", { name: "Plan it" })).toBeEnabled();
    // The suggested answers travel untouched: the first question is open, the second unasked.
    await expect(page.getByRole("radio", { name: "Explain" })).toBeChecked();

    const posted = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith("/lessons"),
    );
    await page.getByRole("button", { name: "Plan it" }).click();
    const request = await posted;
    expect(request.postDataJSON()).toEqual({
      brief: {
        topic: "Fractions of amounts",
        answers: {
          objectiveVerb: "Explain fractions of amounts",
          priorConfidence: "New to it",
        },
      },
      subject: "Science",
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

    // The next brief opens with the class already set and says so, until a field is changed.
    await page.goto("/lessons/new");
    await expect(page.getByRole("combobox", { name: "Subject" })).toHaveText("Science");
    await expect(page.getByRole("combobox", { name: "Year group" })).toHaveText("Year 5");
    await expect(page.getByText("From your last lesson")).toHaveCount(2);
    await expect(page.getByRole("spinbutton", { name: "Duration (minutes)" })).toHaveAttribute(
      "placeholder",
      "60",
    );
    await page.getByRole("combobox", { name: "Year group" }).click();
    await page.getByRole("option", { name: "Year 1", exact: true }).click();
    await expect(page.getByText("From your last lesson")).toHaveCount(1);
    await expect(page.getByRole("spinbutton", { name: "Duration (minutes)" })).toHaveAttribute(
      "placeholder",
      "45",
    );
  });

  test("skipping both questions posts no answers; the guard blocks a pupil reference", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons/new");
    await page.getByRole("textbox", { name: "Topic or objective" }).fill("The water cycle");
    // Skip settles a question and reveals the next, so Skip is clicked twice.
    await page.getByRole("button", { name: "Skip" }).click();
    await page.getByRole("button", { name: "Skip" }).click();
    await expect(page.getByText("Skipped — the plan decides.")).toHaveCount(2);
    await page.getByRole("spinbutton", { name: "Duration (minutes)" }).fill("45");

    await page.getByRole("button", { name: "Add class context" }).click();
    const notes = page.getByRole("textbox", { name: "Notes" });
    await notes.fill("A pupil called Jamie struggles");
    await notes.blur();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Remove pupil names or identifiers before saving.");
    await expect(alert.locator("mark")).toHaveText("pupil called");
    await expect(page.getByRole("button", { name: "Plan it" })).toBeDisabled();
    await expect(page.getByRole("status")).toHaveText(
      "Remove pupil names or identifiers before saving.",
    );
    await notes.fill("Lively after lunch");
    await expect(page.getByRole("button", { name: "Plan it" })).toBeEnabled();

    const posted = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith("/lessons"),
    );
    await page.getByRole("button", { name: "Plan it" }).click();
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

test.describe("lesson brief: start from your material (ADR 0027 §7)", () => {
  test("a PDF and a paste upload through POST /sources, show as chips, and travel as sourceIds", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons/new");
    const zone = page.getByRole("region", { name: /Start from your material/ });
    await expect(zone).toBeVisible();
    await expect(
      zone.getByText("Only upload material you may use for your own teaching."),
    ).toBeVisible();

    // A real PDF through the real API: extracted, screened, stored, registered.
    const uploaded = page.waitForResponse(
      (res) => res.url().endsWith("/sources") && res.request().method() === "POST",
    );
    await zone.locator('input[type="file"]').setInputFiles({
      name: "plants.pdf",
      mimeType: "application/pdf",
      buffer: tinyPdf(MATERIAL),
    });
    expect((await uploaded).status()).toBe(201);
    await expect(page.getByRole("button", { name: "Remove plants.pdf" })).toBeVisible();
    await expect(zone.getByText("1 page")).toBeVisible();

    // Pasted text is a second Source.
    await zone.getByRole("button", { name: "Paste text instead" }).click();
    await page.getByRole("textbox", { name: "Text to use as material" }).fill(MATERIAL);
    await zone.getByRole("button", { name: "Add" }).click();
    await expect(page.getByRole("button", { name: "Remove Pasted text" })).toBeVisible();

    // A class list is refused before anything is stored, with the API's sentence on screen.
    await zone.locator('input[type="file"]').setInputFiles({
      name: "register.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(
        "Amelia Jones\t12/03/2014\nOliver Smith\t03/07/2014\nIsla Brown\t21/11/2013\nGeorge Taylor\t08/01/2014\nAva Wilson\t30/05/2014\n",
      ),
    });
    await expect(page.getByRole("list", { name: "Files we could not take" })).toContainText(
      /Upload a PDF, PowerPoint/,
    );

    await page.getByRole("textbox", { name: "Topic or objective" }).fill("Photosynthesis");
    const posted = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith("/lessons"),
    );
    await page.getByRole("button", { name: "Plan it" }).click();
    const body = (await posted).postDataJSON() as { sourceIds?: string[] };
    expect(body.sourceIds).toHaveLength(2);
    await expect(page).toHaveURL(/\/l\/[0-9a-f-]{36}$/);
  });
});
