/**
 * Authentication flows (ADR 0008): the auth layout redirect, magic-link sign-in through the real
 * form (with the link read back from the api's capture route), keyboard-only sign-in, sign-out.
 */
import {
  E2E_WEB_URL,
  escapeRegExp,
  expect,
  lastMagicLink,
  openMagicLink,
  signIn,
  test,
  uniqueEmail,
} from "./fixtures";

/** One character of the /sign-in cast (TEACH-252). */
const cast = (kind: "slides" | "activity" | "support" | "answers") => `[data-cast="${kind}"]`;

test.describe("auth", () => {
  test("a protected page redirects to /sign-in and remembers where you were going", {
    tag: "@smoke",
  }, async ({ page }) => {
    await page.goto("/dev/jobs");
    await expect(page).toHaveURL(/\/sign-in\?/);
    const search = new URL(page.url()).searchParams;
    expect(search.get("redirect")).toBe("/dev/jobs");
    await expect(page.getByRole("heading", { level: 1, name: "Welcome to DayBack" })).toBeVisible();

    // A target with its own query string round-trips whole, not just the path (TEACH-309): the
    // marketing homepage's ?topic= must survive an unsigned visitor's trip through /sign-in. The
    // brief itself is open to guests (TEACH-244); its upload link (`source=1`) still signs in.
    await page.goto("/lessons/new?topic=The+cycle&source=1");
    await expect(page).toHaveURL(/\/sign-in\?/);
    const searchWithQuery = new URL(page.url()).searchParams;
    expect(searchWithQuery.get("redirect")).toBe("/lessons/new?topic=The+cycle&source=1");
  });

  test("magic link from the form signs in and lands on the redirect target", {
    tag: "@smoke",
  }, async ({ page, request }) => {
    const email = uniqueEmail("form");
    await page.goto("/sign-in?redirect=%2Fdev%2Fjobs");
    await page.getByLabel("Email address").fill(email.toUpperCase());
    await page.getByRole("button", { name: "Email me a link" }).click();
    await expect(page.getByRole("status")).toHaveText(/Check your inbox/);

    // The form lower-cases the address; the api "sent" the mail to that address.
    const link = await lastMagicLink(request, email);
    expect(link.startsWith(`${E2E_WEB_URL}/sign-in/confirm?token=`)).toBe(true);
    await openMagicLink(page, link);

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

    await openMagicLink(page, await lastMagicLink(request, email));

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
    // The confirm page's one button is reachable by Tab and Enter presses it (TEACH-246).
    const signInButton = page.getByRole("button", { name: "Sign in", exact: true });
    for (
      let i = 0;
      i < 5 && !(await signInButton.evaluate((el) => el === document.activeElement));
      i++
    ) {
      await page.keyboard.press("Tab");
    }
    await expect(signInButton).toBeFocused();
    await page.keyboard.press("Enter");
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
    await page.clock.install();
    await page.goto("/sign-in");
    // Slides and Worksheet climb out from behind the card on arrival,
    // Worksheet a beat after Slides: `cast-rig.ts` `enter` ends the climb 1.23 s after the stage
    // goes live (0.15 s delay, 0.18 s stagger, 0.9 s climb). Play that on the clock, then measure.
    await expect(page.locator("[data-cast-stage]")).toHaveAttribute("data-cast-stage", "live");
    await page.clock.runFor(1_300);
    const google = await page.getByRole("button", { name: "Continue with Google" }).boundingBox();
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

  test("/sign-in: both ways in show the pointer cursor", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCSS(
      "cursor",
      "pointer",
    );
    await expect(page.getByRole("button", { name: "Email me a link" })).toHaveCSS(
      "cursor",
      "pointer",
    );
  });

  test("sign out returns to /sign-in and protected pages are locked again", {
    tag: "@smoke",
  }, async ({ page, request }) => {
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

  test("a used magic link sends you to /sign-in with an explanation", { tag: "@smoke" }, async ({
    page,
    request,
  }) => {
    const email = await signIn(page, request);
    const link = await lastMagicLink(request, email);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);

    // Tokens are single-use: pressing Sign in on the used link fails verification and better-auth
    // redirects to our errorCallbackURL with `?error=INVALID_TOKEN` (TEACH-68).
    await openMagicLink(page, link);
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
    await openMagicLink(page, await lastMagicLink(request, email));
    await expect(page).toHaveURL(new RegExp(`^${escapeRegExp(E2E_WEB_URL)}/$`));
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  });

  test("a mail scanner that fetches the link does not use it up (TEACH-246)", {
    tag: "@smoke",
  }, async ({ page, request, browser }) => {
    const email = uniqueEmail("scanner");
    await page.goto("/sign-in?redirect=%2Fdev%2Fjobs");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Email me a link" }).click();
    await expect(page.getByRole("status")).toHaveText(/Check your inbox/);
    const link = await lastMagicLink(request, email);

    // A scanner GETs the link twice without running the page, then another one renders it.
    for (let i = 0; i < 2; i++) expect((await request.get(link)).ok()).toBe(true);
    const scanner = await browser.newContext();
    const scanned = await scanner.newPage();
    const verifyHits: string[] = [];
    scanned.on("request", (r) => {
      if (r.url().includes("/magic-link/verify")) verifyHits.push(r.url());
    });
    await scanned.goto(link);
    await expect(
      scanned.getByRole("heading", { level: 1, name: "Sign in to DayBack" }),
    ).toBeVisible();
    await scanned.waitForLoadState("networkidle");
    expect(verifyHits).toEqual([]);
    await scanner.close();

    // The teacher opens it later, on this device, and signs in to where they were going.
    await openMagicLink(page, link);
    await expect(page).toHaveURL(/\/dev\/jobs$/);
    await expect(page.getByText("Jobs / SSE demo", { exact: true })).toBeVisible();
  });
});
