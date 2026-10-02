/**
 * Signed-out first lesson (TEACH-244; BUILD-SPLIT §4 rows 1–2 and 6): a visitor with no cookie
 * reaches the brief, the first submit makes an anonymous session and one lesson, the objectives
 * step follows (SO-1), Confirm lands on `/l/<id>` generating, and account-only pages still sign in.
 * Signed-out lessons are always on (no flag in the api or the web); the e2e stack runs the
 * fake AI (`playwright.config.ts`). TEACH-245 appends rows 3–4 (read-only lesson, sign-in sheet).
 */
import { expect, test } from "./fixtures";

test.use({ seed: false });

test.describe("signed-out first lesson", () => {
  test("homepage topic → brief → objectives → generating, with no sign-in step", async ({
    page,
  }) => {
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

  test("account-only pages still send a visitor to /sign-in (row 6)", async ({ page }) => {
    for (const path of ["/", "/worksheets", "/l/00000000-0000-4000-8000-000000000000/print"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/sign-in\?/);
      expect(new URL(page.url()).searchParams.get("redirect")).toBe(path);
    }
    // A lesson URL with no session at all is not a guest page either.
    await page.goto("/l/00000000-0000-4000-8000-000000000000");
    await expect(page).toHaveURL(/\/sign-in\?/);
  });

  test("an anonymous visitor is sent to /sign-in from the library (row 7)", async ({ page }) => {
    await page.goto("/lessons/new?topic=Rocks");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page).toHaveURL(/\/lessons\/new\?lesson=/);
    await page.goto("/lessons");
    await expect(page).toHaveURL(/\/sign-in\?/);
  });
});
