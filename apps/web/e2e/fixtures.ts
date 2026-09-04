/**
 * Shared Playwright fixtures (TEACH-22). Import `test`/`expect` from here, not from
 * `@playwright/test`, so every spec gets `signedInPage` and the sign-in helpers.
 *
 * Sign-in never touches a mailbox: the spec asks the api for a magic link like the real form
 * does, then reads the link back from the test-only `GET /__test/last-magic-link` route (mounted
 * only under `NODE_ENV=test` + `ENABLE_TEST_ROUTES=1`, see apps/api/README.md) and visits it.
 */
import { type APIRequestContext, test as base, expect, type Page } from "@playwright/test";
import { E2E_API_URL, E2E_WEB_URL } from "../playwright.config";

export { E2E_API_URL, E2E_WEB_URL };

/** A fresh address per test so specs never share a user (the e2e database is not truncated). */
export function uniqueEmail(prefix = "e2e"): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${rand}@example.test`;
}

/** Ask the api to "send" a magic link for `email` exactly like the sign-in form does. */
export async function requestMagicLink(
  request: APIRequestContext,
  email: string,
  callbackPath = "/",
): Promise<void> {
  const res = await request.post(`${E2E_API_URL}/auth/sign-in/magic-link`, {
    headers: { origin: E2E_WEB_URL },
    data: { email, callbackURL: `${E2E_WEB_URL}${callbackPath}` },
  });
  expect(res.ok(), `magic-link request failed: ${res.status()} ${await res.text()}`).toBe(true);
}

/** Read the last magic link the api sent to `email` through the capture route. */
export async function lastMagicLink(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.get(`${E2E_API_URL}/__test/last-magic-link`, { params: { email } });
  expect(
    res.ok(),
    `GET /__test/last-magic-link failed: ${res.status()} — is the api running with NODE_ENV=test ENABLE_TEST_ROUTES=1?`,
  ).toBe(true);
  const body = (await res.json()) as { url: string };
  return body.url;
}

/** Full sign-in: request link → read it back → visit it → land on `callbackPath`, signed in. */
export async function signIn(
  page: Page,
  request: APIRequestContext,
  email = uniqueEmail(),
  callbackPath = "/",
): Promise<string> {
  await requestMagicLink(request, email, callbackPath);
  await page.goto(await lastMagicLink(request, email));
  await expect(page).toHaveURL(
    new RegExp(`^${escapeRegExp(E2E_WEB_URL)}${escapeRegExp(callbackPath)}`),
  );
  return email;
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface SignedIn {
  page: Page;
  email: string;
}

export const test = base.extend<{ signedInPage: SignedIn }>({
  /** A page whose browser context holds a valid session for a brand-new user, sitting on `/`. */
  signedInPage: async ({ page, request }, use) => {
    const email = await signIn(page, request);
    await expect(page.getByRole("heading", { level: 1, name: /^Hello/ })).toBeVisible();
    await use({ page, email });
  },
});

export { expect };
