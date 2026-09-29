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
    // The confirm sheet opens with focus on itself; one Tab reaches its button, and nothing in the
    // inert preview behind it takes a tab stop (TEACH-246, UX ruling 126).
    const sheet = page.getByRole("dialog");
    const signInButton = sheet.getByRole("button", { name: "Open my lessons" });
    await expect(sheet).toBeFocused();
    await page.keyboard.press("Tab");
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
    await page.goto("/sign-in");
    // Slides and Worksheet climb out from behind the card on arrival (sign-in-cast.spec.ts),
    // Worksheet a beat after Slides; measure once both are up.
    const googleButton = page.getByRole("button", { name: "Continue with Google" });
    await expect
      .poll(async () => {
        const [slides, activity, button] = [
          await page.locator(cast("slides")).boundingBox(),
          await page.locator(cast("activity")).boundingBox(),
          await googleButton.boundingBox(),
        ];
        return slides && activity && button ? slides.y < button.y && activity.y < button.y : false;
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

  test("a used link shows the expired sheet over the same preview, with the resend form (TEACH-214)", async ({
    page,
    request,
  }) => {
    const email = await signIn(page, request, uniqueEmail("used"), "/lessons/new?topic=Volcanoes");
    const link = await lastMagicLink(request, email);
    await page.goto("/");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);

    // Tokens are single-use: the used link fails verification and better-auth sends the teacher
    // back to the confirm page with `?error=INVALID_TOKEN` and no token.
    await openMagicLink(page, link);
    await expect(page).toHaveURL(/\/sign-in\/confirm\?/);
    const search = new URL(page.url()).searchParams;
    expect(search.get("error")).toBe("INVALID_TOKEN");
    expect(search.has("token")).toBe(false);
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "This link has expired" })).toBeVisible();
    await expect(page.locator('[data-confirm-preview="new-lesson"]')).toContainText("Volcanoes");
    // This browser never asked for a link through the form (signIn used the api), so nothing
    // prefills it: the email is never read from the URL.
    await expect(sheet.getByLabel("Email address")).toHaveValue("");
    await sheet.getByLabel("Email address").fill(email);

    // A fresh link from the sheet keeps the destination and drops the error.
    await sheet.getByRole("button", { name: "Email me a new link" }).click();
    await expect(sheet.getByRole("status")).toContainText("Check your inbox");
    await openMagicLink(page, await lastMagicLink(request, email));
    await expect(page).toHaveURL(/\/lessons\/new\?topic=Volcanoes$/);
  });

  test("a new-lesson link previews the topic and lands on the brief with it (TEACH-214)", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("topic");
    await page.goto("/sign-in?redirect=%2Flessons%2Fnew%3Ftopic%3DVolcanoes%2Band%2Bplates");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Email me a link" }).click();
    await expect(page.getByRole("status")).toHaveText(/Check your inbox/);

    await page.goto(await lastMagicLink(request, email));
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "Continue to DayBack" })).toBeVisible();
    // No personal data in the link: the address is not in the URL, encoded or not.
    expect(page.url()).not.toMatch(/@|%40/);
    await expect(page.locator('[data-confirm-preview="new-lesson"]')).toContainText(
      "Volcanoes and plates",
    );
    await sheet.getByRole("button", { name: "Start my lesson" }).click();
    await expect(page).toHaveURL(/\/lessons\/new\?topic=Volcanoes\+and\+plates$/);
    await expect(page.getByLabel("Topic")).toHaveValue("Volcanoes and plates");
  });

  test("a link whose callback was changed to another origin lands on this origin (TEACH-214)", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("tamper");
    await page.goto("/sign-in");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Email me a link" }).click();
    await expect(page.getByRole("status")).toHaveText(/Check your inbox/);
    const tampered = new URL(await lastMagicLink(request, email));
    tampered.searchParams.set("callbackURL", "https://evil.example/steal");

    await openMagicLink(page, tampered.toString());
    await expect(page).toHaveURL(new RegExp(`^${escapeRegExp(E2E_WEB_URL)}/$`));
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  });

  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ] as const) {
    test(`the confirm sheet fits ${width}: no sideways scroll, no layout shift, preview inert (TEACH-214)`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ width, height });
      const email = uniqueEmail(`fit${width}`);
      await page.goto("/sign-in");
      await page.getByLabel("Email address").fill(email);
      await page.getByRole("button", { name: "Email me a link" }).click();
      await expect(page.getByRole("status")).toHaveText(/Check your inbox/);

      await page.addInitScript(() => {
        (window as unknown as { __cls: number }).__cls = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as unknown as {
            value: number;
            hadRecentInput: boolean;
          }[]) {
            if (!entry.hadRecentInput)
              (window as unknown as { __cls: number }).__cls += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      await page.goto(await lastMagicLink(request, email));
      const button = page.getByRole("dialog").getByRole("button", { name: "Open my lessons" });
      await expect(button).toBeInViewport({ ratio: 1 });
      await page.waitForTimeout(1000);
      const { scrollWidth, innerWidth, cls } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        cls: (window as unknown as { __cls: number }).__cls,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
      expect(cls).toBeLessThan(0.02);
      const preview = page.locator('[data-confirm-preview="dashboard"]');
      await expect(preview).toHaveAttribute("aria-hidden", "true");
      expect(await preview.evaluate((el) => (el as HTMLElement).inert)).toBe(true);

      await button.click();
      await expect(page).toHaveURL(new RegExp(`^${escapeRegExp(E2E_WEB_URL)}/$`));
      await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    });
  }

  test("a mail scanner that fetches the link does not use it up (TEACH-246)", async ({
    page,
    request,
    browser,
  }) => {
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
      scanned.getByRole("heading", { level: 1, name: "Continue to DayBack" }),
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
