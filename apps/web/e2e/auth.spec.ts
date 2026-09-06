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

test.describe("auth", () => {
  test("a protected page redirects to /sign-in and remembers where you were going", async ({
    page,
  }) => {
    await page.goto("/dev/jobs");
    await expect(page).toHaveURL(/\/sign-in\?/);
    const search = new URL(page.url()).searchParams;
    expect(search.get("redirect")).toBe("/dev/jobs");
    await expect(page.getByText("Sign in to Teaching Journey")).toBeVisible();
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

  test("keyboard-only sign-in: Tab to the field, type, Enter", async ({ page, request }) => {
    const email = uniqueEmail("kbd");
    await page.goto("/sign-in");
    await expect(page.getByText("Sign in to Teaching Journey")).toBeVisible();

    // Tab from the document until the email field owns focus (no mouse anywhere in this test).
    const emailField = page.getByLabel("Email address");
    for (
      let i = 0;
      i < 6 && !(await emailField.evaluate((el) => el === document.activeElement));
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

  test("sign out returns to /sign-in and protected pages are locked again", async ({
    page,
    request,
  }) => {
    await signIn(page, request);
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
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
