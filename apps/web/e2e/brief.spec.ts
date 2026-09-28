/**
 * The lesson intake at `/lessons/new` (F01 item 2, TEACH-122; #303): the brief step, planning to
 * objectives, and Skip planning straight to `/l/:id`.
 * The e2e worker has no Bedrock token (or a developer's has one and spends real money), so the
 * spec asserts the hand-over to the lesson page and the request shape, not a finished deck.
 */
import { GUARD_MESSAGE } from "@tj/domain/documents";
import { E2E_API_URL } from "../playwright.config";
import { expect, test } from "./fixtures";
import { MATERIAL, tinyPdf } from "./source-fixtures";

test.use({ seed: false });

test.describe("lesson brief", () => {
  test("New lesson opens the focused intake with its heading focused", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons");
    await page.getByRole("button", { name: "New lesson" }).click();
    await expect(page).toHaveURL(/\/lessons\/new$/);
    await expect(page).toHaveTitle("New lesson · DayBack");
    // The intake sits outside the library shell; each step announces its heading.
    await expect(page.getByRole("navigation", { name: "Library" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Let’s start with your idea." })).toBeFocused();
    await expect(page.getByRole("textbox", { name: "Topic", exact: true })).toHaveValue("");
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Skip planning" })).toBeDisabled();
    await expect(page.getByRole("combobox", { name: "Year group" })).toHaveText("Year 4");
    await expect(page.getByRole("button", { name: "Blank lesson" })).toBeVisible();
  });

  test("?topic= prefills the topic and never auto-submits (TEACH-309)", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons/new?topic=Fractions%20of%20amounts");
    await expect(page.getByRole("textbox", { name: "Topic", exact: true })).toHaveValue(
      "Fractions of amounts",
    );
    await expect(page.getByRole("button", { name: "Next" })).toBeEnabled();
    // Nothing has submitted: still the brief, not the plan it would open to.
    await expect(page).toHaveURL(/\/lessons\/new\?topic=/);
    await expect(page.getByRole("heading", { name: "Let’s start with your idea." })).toBeVisible();
  });

  test("?source=1 opens the materials dialog with Choose files focused (TEACH-309)", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons/new?source=1");
    await expect(page.getByRole("dialog", { name: "Add your materials" })).toBeVisible();
    // `input[type=file]` also carries an implicit "button" role under the same accessible name
    // (it is `aria-label`led "Choose files" too), so scope to the real `<button>` element.
    const chooseFiles = page.locator("button", { hasText: "Choose files" });
    await expect(chooseFiles).toBeFocused();
    await expect(chooseFiles).toBeInViewport();
  });

  test("Next posts the brief, plans the objectives, and the year group is remembered", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons/new");
    await page.getByRole("textbox", { name: "Topic", exact: true }).fill("Fractions of amounts");
    await page.getByRole("combobox", { name: "Year group" }).click();
    await page.getByRole("option", { name: "Year 5" }).click();

    const posted = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith("/lessons"),
    );
    await page.getByRole("button", { name: "Next" }).click();
    const request = await posted;
    expect(request.postDataJSON()).toMatchObject({
      brief: { topic: "Fractions of amounts", level: "standard", slideCount: 8 },
      yearGroup: "Year 5",
      sourceIds: [],
      skipPlanning: false,
    });
    expect((await request.response())?.status()).toBe(202);
    await expect(page).toHaveURL(/\/lessons\/new\?lesson=[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Learning objectives" })).toBeVisible({
      timeout: 35_000,
    });
    await expect(page.getByRole("textbox", { name: /^Objective / })).not.toHaveCount(0);

    // Back to the brief: the plan exists, so Skip planning is gone (a changed brief must replan
    // first) and Next is the only way on.
    await page.getByRole("button", { name: "Back to the brief" }).click();
    await expect(page.getByRole("heading", { name: "Let’s start with your idea." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Skip planning" })).toHaveCount(0);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("heading", { name: "Learning objectives" })).toBeVisible();

    // The next brief opens with the class already set.
    await page.goto("/lessons/new");
    await expect(page.getByRole("combobox", { name: "Year group" })).toHaveText("Year 5");
  });

  test("the guard blocks a pupil reference; Skip planning goes straight to the lesson", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons/new");
    const topic = page.getByRole("textbox", { name: "Topic", exact: true });
    await topic.fill("A pupil called Jamie struggles with the water cycle");
    await expect(page.getByRole("status").filter({ hasText: GUARD_MESSAGE })).toBeVisible();
    let posts = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/lessons")) posts += 1;
    });
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page).toHaveURL(/\/lessons\/new$/);
    expect(posts).toBe(0);

    await topic.fill("The water cycle");
    await expect(page.getByText(GUARD_MESSAGE)).toHaveCount(0);
    const posted = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith("/lessons"),
    );
    await page.getByRole("button", { name: "Skip planning" }).click();
    expect((await posted).postDataJSON()).toMatchObject({
      brief: { topic: "The water cycle" },
      skipPlanning: true,
    });
    await expect(page).toHaveURL(/\/l\/[0-9a-f-]{36}$/);
  });
});

test.describe("lesson brief: start from your material (ADR 0027 §7)", () => {
  test("a PDF and a paste upload through POST /sources, show as chips, and travel as sourceIds", async ({
    signedInPage: { page },
  }) => {
    await page.goto("/lessons/new");
    await page.getByRole("button", { name: "Add materials" }).click();
    const zone = page.getByRole("dialog", { name: "Add your materials" });
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
    await zone.getByRole("tab", { name: "Paste text" }).click();
    await page.getByRole("textbox", { name: "Text to use as material" }).fill(MATERIAL);
    await zone.getByRole("button", { name: "Add text" }).click();
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

    await zone.getByRole("button", { name: "Done" }).click();
    await page.getByRole("textbox", { name: "Topic", exact: true }).fill("Photosynthesis");
    const posted = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith("/lessons"),
    );
    // Skip planning runs one job to the end, so the worker's read of the Sources is asserted too.
    await page.getByRole("button", { name: "Skip planning" }).click();
    const body = (await posted).postDataJSON() as { sourceIds?: string[] };
    expect(body.sourceIds).toHaveLength(2);
    await expect(page).toHaveURL(/\/l\/[0-9a-f-]{36}$/);

    // The worker reads the Sources' extracted.json and plans from it: the lesson finishes and the
    // stored body carries both references (TEACH-273 keeps api and worker on one storage root).
    await expect(page.getByRole("button", { name: "Rename lesson" })).toBeVisible({
      timeout: 60_000,
    });
    const lessonId = page.url().split("/").pop() ?? "";
    const doc = await page.request.get(`${E2E_API_URL}/documents/${lessonId}`);
    const lesson = (
      (await doc.json()) as {
        document: { body: { sources?: unknown[]; slides: unknown[] } };
      }
    ).document.body;
    expect(lesson.sources).toHaveLength(2);
    expect(lesson.slides.length).toBeGreaterThan(2);
  });
});
