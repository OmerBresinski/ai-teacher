/**
 * Authentication flows (ADR 0008): the auth layout redirect, magic-link sign-in through the real
 * form (with the link read back from the api's capture route), keyboard-only sign-in, sign-out.
 */
import {
  E2E_WEB_URL,
  escapeRegExp,
  expect,
  lastMagicLink,
  signIn,
  test,
  uniqueEmail,
} from "./fixtures";

/** One character of the /sign-in cast (TEACH-252). */
const cast = (kind: "slides" | "activity" | "support" | "answers") => `[data-cast="${kind}"]`;

test.describe("auth", () => {
  test("a protected page redirects to /sign-in and remembers where you were going", async ({
    page,
  }) => {
    await page.goto("/dev/jobs");
    await expect(page).toHaveURL(/\/sign-in\?/);
    const search = new URL(page.url()).searchParams;
    expect(search.get("redirect")).toBe("/dev/jobs");
    await expect(page.getByRole("heading", { level: 1, name: "Welcome to DayBack" })).toBeVisible();

    // A target with its own query string round-trips whole, not just the path (TEACH-309): the
    // marketing homepage's ?topic= must survive an unsigned visitor's trip through /sign-in.
    await page.goto("/lessons/new?topic=The+cycle");
    await expect(page).toHaveURL(/\/sign-in\?/);
    const searchWithQuery = new URL(page.url()).searchParams;
    expect(searchWithQuery.get("redirect")).toBe("/lessons/new?topic=The+cycle");
  });

  test("magic link from the form signs in and lands on the redirect target", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("form");
    await page.goto("/sign-in?redirect=%2Fdev%2Fjobs");
    await page.getByLabel("Email address").fill(email.toUpperCase());
    await page.getByRole("button", { name: "Email me a link" }).click();
    await expect(page.getByRole("status")).toHaveText(/Check your inbox/);

    // The form lower-cases the address; the api "sent" the mail to that address.
    const link = await lastMagicLink(request, email);
    expect(link).toContain("/auth/magic-link/verify?token=");
    await page.goto(link);

    await expect(page).toHaveURL(/\/dev\/jobs$/);
    await expect(page.getByText("Jobs / SSE demo", { exact: true })).toBeVisible();

    // A second visit is a plain page load with the session cookie: no redirect to /sign-in.
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  });

  test("magic link keeps a redirect target's query string intact (TEACH-309)", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("query");
    await page.goto("/sign-in?redirect=%2Flessons%2Fnew%3Ftopic%3DThe%2Bcycle");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Email me a link" }).click();
    await expect(page.getByRole("status")).toHaveText(/Check your inbox/);

    const link = await lastMagicLink(request, email);
    await page.goto(link);

    await expect(page).toHaveURL(/\/lessons\/new\?topic=The\+cycle$/);
  });

  test("keyboard-only sign-in: Tab to the field, type, Enter", async ({ page, request }) => {
    const email = uniqueEmail("kbd");
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { level: 1, name: "Welcome to DayBack" })).toBeVisible();

    // Tab from the document until the email field owns focus (no mouse anywhere in this test).
    // "Continue with Google" is one tab stop before it (TEACH-31).
    const emailField = page.getByLabel("Email address");
    for (
      let i = 0;
      i < 7 && !(await emailField.evaluate((el) => el === document.activeElement));
      i++
    ) {
      await page.keyboard.press("Tab");
    }
    await expect(emailField).toBeFocused();
    await page.keyboard.type(email);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toHaveText(/Check your inbox/);

    await page.goto(await lastMagicLink(request, email));
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  });

  test("/sign-in fits a 390 viewport: no sideways scroll, email field and submit on screen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { level: 1, name: "Welcome to DayBack" })).toBeVisible();
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
    await expect(page.getByLabel("Email address")).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("button", { name: "Email me a link" })).toBeInViewport({
      ratio: 1,
    });
    // On a phone only Slides and Worksheet peek over the card; Plan and Check are desktop artwork.
    await expect(page.locator(cast("slides"))).toBeVisible();
    await expect(page.locator(cast("support"))).toBeHidden();
    await expect(page.locator(cast("answers"))).toBeHidden();
  });

  test("/sign-in at 1440: the cast stands around the card, hidden from screen readers", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/sign-in");
    // Slides and Worksheet climb out from behind the card on arrival (sign-in-cast.spec.ts);
    // measure once they are up.
    const googleButton = page.getByRole("button", { name: "Continue with Google" });
    await expect
      .poll(async () => {
        const [peeker, button] = [
          await page.locator(cast("slides")).boundingBox(),
          await googleButton.boundingBox(),
        ];
        return peeker && button ? peeker.y < button.y : false;
      })
      .toBe(true);
    const google = await googleButton.boundingBox();
    const heading = await page.getByRole("heading", { level: 1 }).boundingBox();
    const box = async (kind: Parameters<typeof cast>[0]) => {
      const character = page.locator(cast(kind));
      await expect(character).toBeVisible();
      const found = await character.boundingBox();
      if (!found) throw new Error(`${kind} has no box`);
      return found;
    };
    const [slides, activity, support, answers] = [
      await box("slides"),
      await box("activity"),
      await box("support"),
      await box("answers"),
    ];
    if (!google || !heading) throw new Error("layout boxes missing");
    // Slides and Worksheet peek over the card, under the heading; Plan and Check flank it.
    for (const peeker of [slides, activity]) {
      expect(peeker.y).toBeGreaterThan(heading.y + heading.height);
      expect(peeker.y).toBeLessThan(google.y);
    }
    expect(support.x + support.width / 2).toBeLessThan(google.x);
    expect(answers.x + answers.width / 2).toBeGreaterThan(google.x + google.width);
    await expect(page.locator("[data-cast-stage]")).toHaveAttribute("aria-hidden", "true");
  });

  test("Continue with Google says it is not set up when the api has no Google client", async ({
    page,
  }) => {
    // playwright.config.ts blanks GOOGLE_CLIENT_ID/SECRET, so the api answers 404
    // PROVIDER_NOT_FOUND and the page stays put with a plain sentence (TEACH-31).
    await page.goto("/sign-in?redirect=%2Flessons");
    const social = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/auth/sign-in/social"),
    );
    await page.getByRole("button", { name: "Continue with Google" }).click();
    expect((await social).status()).toBe(404);
    await expect(page.getByRole("alert")).toHaveText(
      "Google sign-in is not set up here. Use the email link below.",
    );
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
    await expect(page).toHaveURL(/\/sign-in\?redirect=%2Flessons$/);
  });

  test("sign out returns to /sign-in and protected pages are locked again", async ({
    page,
    request,
  }) => {
    await signIn(page, request);
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

    const signOutResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/auth/sign-out",
    );
    await page.getByRole("button", { name: "Sign out" }).click();
    await signOutResponse;
    await expect(page).toHaveURL(/\/sign-in$/);

    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in\?/);
    expect(new URL(page.url()).searchParams.get("redirect")).toBe("/");
  });

  test("a used magic link sends you to /sign-in with an explanation", async ({ page, request }) => {
    const email = await signIn(page, request);
    const link = await lastMagicLink(request, email);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);

    // Tokens are single-use: the second visit fails verification and better-auth redirects to
    // our errorCallbackURL with `?error=INVALID_TOKEN` (TEACH-68).
    await page.goto(link);
    await expect(page).toHaveURL(/\/sign-in\?/);
    const search = new URL(page.url()).searchParams;
    expect(search.get("error")).toBe("INVALID_TOKEN");
    expect(search.get("redirect")).toBe("/");
    await expect(page.getByRole("alert")).toHaveText(
      "That sign-in link has expired or was already used. Request a new one below.",
    );

    // Requesting a fresh link from here must not carry the error into the next callback.
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Email me a link" }).click();
    await expect(page.getByRole("status")).toHaveText(/Check your inbox/);
    await page.goto(await lastMagicLink(request, email));
    await expect(page).toHaveURL(new RegExp(`^${escapeRegExp(E2E_WEB_URL)}/$`));
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  });
});
