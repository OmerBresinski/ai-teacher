/**
 * Signed-out first lesson (TEACH-244; BUILD-SPLIT §4 rows 1–2 and 6): a visitor with no cookie
 * reaches the brief, the first submit makes an anonymous session and one lesson, the objectives
 * step follows (SO-1), Confirm lands on `/l/<id>` generating, and account-only pages still sign in.
 * Signed-out lessons are always on (no flag in the api or the web); the e2e stack runs the
 * fake AI (`playwright.config.ts`). TEACH-245 appends rows 3–4 (read-only lesson, sign-in sheet)
 * and the existing-account journey (ruling 127): edit and Export open the sheet, the lesson moves
 * into an account that already has lessons, and Export lands on its print view.
 */
import {
  E2E_API_URL,
  expect,
  lastMagicLink,
  openMagicLink,
  seedLibrary,
  signInByApi,
  test,
  uniqueEmail,
} from "./fixtures";

test.use({ seed: false });

test.describe("signed-out first lesson", () => {
  test("homepage topic → brief → objectives → generating, with no sign-in step", {
    tag: "@smoke",
  }, async ({ page }) => {
    // Row 1: no redirect, topic prefilled, no drop zone and no Blank lesson (ruling 110).
    await page.goto("/lessons/new?topic=Volcanoes");
    await expect(page).toHaveURL(/\/lessons\/new\?topic=Volcanoes$/);
    await expect(page.getByRole("textbox", { name: "Topic", exact: true })).toHaveValue(
      "Volcanoes",
    );
    await expect(page.getByRole("dialog", { name: "Add your materials" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Blank lesson" })).toHaveCount(0);

    // Row 2: one anonymous sign-in, then one create carrying a requestId.
    const writes: { path: string; body: unknown; captcha: string | null }[] = [];
    page.on("request", (request) => {
      if (request.method() !== "POST") return;
      const path = new URL(request.url()).pathname;
      writes.push({
        path,
        body: request.postDataJSON?.() ?? null,
        captcha: request.headers()["x-captcha-response"] ?? null,
      });
    });
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page).toHaveURL(/\/lessons\/new\?lesson=[0-9a-f-]{36}$/);
    const signIns = writes.filter((w) => w.path.endsWith("/auth/sign-in/anonymous"));
    const creates = writes.filter((w) => w.path.endsWith("/lessons"));
    expect(signIns).toHaveLength(1);
    expect(creates).toHaveLength(1);
    expect(creates[0]?.body).toMatchObject({
      brief: { topic: "Volcanoes" },
      skipPlanning: false,
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });

    // SO-1: the objectives step for the topic; Continue generates with no worksheet step.
    await expect(page.getByRole("heading", { name: "Learning objectives" })).toBeVisible({
      timeout: 35_000,
    });
    await expect(page.getByRole("textbox", { name: /^Objective / })).not.toHaveCount(0);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/l\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    expect(writes.filter((w) => /\/lessons\/[0-9a-f-]{36}\/generate$/.test(w.path))).toHaveLength(
      1,
    );
    await expect(page.getByRole("heading", { name: "Add a worksheet?" })).toHaveCount(0);
    expect(page.url()).not.toContain("/sign-in");
  });

  test("account-only pages still send a visitor to /sign-in (row 6)", { tag: "@smoke" }, async ({
    page,
  }) => {
    for (const path of ["/", "/worksheets", "/l/00000000-0000-4000-8000-000000000000/print"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/sign-in\?/);
      expect(new URL(page.url()).searchParams.get("redirect")).toBe(path);
    }
    // A lesson URL with no session at all is not a guest page either.
    await page.goto("/l/00000000-0000-4000-8000-000000000000");
    await expect(page).toHaveURL(/\/sign-in\?/);
  });

  test("an anonymous visitor is sent to /sign-in from the library (row 7)", {
    tag: "@smoke",
  }, async ({ page }) => {
    await page.goto("/lessons/new?topic=Rocks");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page).toHaveURL(/\/lessons\/new\?lesson=/);
    await page.goto("/lessons");
    await expect(page).toHaveURL(/\/sign-in\?/);
  });
  test("the lesson is read-only, and the sign-in sheet returns to it editable (rows 3–4)", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/lessons/new?topic=Volcanoes");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("heading", { name: "Learning objectives" })).toBeVisible({
      timeout: 35_000,
    });
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/l\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    const lessonPath = new URL(page.url()).pathname;

    // Row 3: Export is only the sheet's door, and one sign-in action opens the sheet over it.
    const signInAction = page.getByRole("button", { name: "Sign in to edit, export and save" });
    const exportDoor = page.locator("[data-sign-in-to-export]");
    await expect(signInAction).toBeVisible();
    await expect(page.getByRole("button", { name: "Present" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Export", exact: true })).toHaveCount(1);
    await expect(exportDoor).toHaveCount(1);
    await signInAction.click();
    const sheet = page.getByRole("dialog", { name: "Sign in to edit, export and save" });
    await expect(sheet).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(lessonPath);

    // Row 4: a new email's link lands on the same lesson, now the teacher's and editable.
    const email = uniqueEmail("t245");
    await sheet.getByRole("textbox", { name: "Email address" }).fill(email);
    await sheet.getByRole("button", { name: "Email me a link" }).click();
    await expect(sheet.getByText("Check your inbox")).toBeVisible({ timeout: 15_000 });
    await openMagicLink(page, await lastMagicLink(request, email));
    await expect(page).toHaveURL(new RegExp(`${lessonPath}$`), { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Export", exact: true })).toBeVisible();
    await expect(exportDoor).toHaveCount(0);
    await expect(signInAction).toHaveCount(0);
  });

  test("a guest who tries to edit, then exports into an existing account, keeps the lesson (ruling 127)", {
    tag: "@smoke",
  }, async ({ page, request, browser }) => {
    test.setTimeout(150_000);
    // An account that already exists and already has lessons: the claim must move, not hand over.
    const email = uniqueEmail("t245-existing");
    const elsewhere = await browser.newContext();
    const other = await elsewhere.newPage();
    await signInByApi(other, request, email);
    const seeded = await seedLibrary(other);
    await elsewhere.close();

    // A guest generates a lesson.
    const writes: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "PUT" && r.url().includes("/documents/")) writes.push(r.url());
    });
    await page.goto("/lessons/new?topic=Volcanoes");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("heading", { name: "Learning objectives" })).toBeVisible({
      timeout: 35_000,
    });
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/l\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    const lessonPath = new URL(page.url()).pathname;
    await expect(page.getByRole("button", { name: "Present" })).toBeVisible({ timeout: 60_000 });

    // Trying to edit opens the sign-in sheet; nothing is written and nothing fails silently.
    await page.locator("[data-lesson-viewer] main").first().dblclick();
    const editSheet = page.getByRole("dialog", { name: "Sign in to edit, export and save" });
    await expect(editSheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(editSheet).toHaveCount(0);
    expect(writes).toEqual([]);
    await expect(page.locator('[data-save-state="failed"]')).toHaveCount(0);

    // Export goes through the same sheet and comes back on the print view of the moved lesson.
    await page.locator("[data-sign-in-to-export]").click();
    const sheet = page.getByRole("dialog", { name: "Sign in to export" });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("textbox", { name: "Email address" }).fill(email);
    await sheet.getByRole("button", { name: "Email me a link" }).click();
    await expect(sheet.getByText("Check your inbox")).toBeVisible({ timeout: 15_000 });
    await openMagicLink(page, await lastMagicLink(request, email));
    await expect(page).toHaveURL(new RegExp(`${lessonPath}/print`), { timeout: 15_000 });
    await expect(page.locator(".td-print .td-print-page").first()).toBeVisible({
      timeout: 15_000,
    });

    // The lesson is in the account beside its own lessons, and it edits and saves.
    const lessonId = lessonPath.split("/").pop() ?? "";
    expect((await page.request.get(`${E2E_API_URL}/documents/${lessonId}`)).status()).toBe(200);
    const own = Object.values(seeded)[0] ?? "";
    expect((await page.request.get(`${E2E_API_URL}/documents/${own}`)).status()).toBe(200);
    await page.goto(lessonPath);
    await expect(page.getByText("We couldn't move this lesson")).toHaveCount(0);
    await page.getByRole("button", { name: "Rename lesson" }).click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("Volcanoes, kept");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-save-state="saved"]')).toBeVisible({ timeout: 10_000 });
    const saved = await page.request.get(`${E2E_API_URL}/documents/${lessonId}`);
    expect(JSON.stringify(await saved.json())).toContain('"title":"Volcanoes, kept"');
  });
});
