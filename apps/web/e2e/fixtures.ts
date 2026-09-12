/**
 * Shared Playwright fixtures (TEACH-22). Import `test`/`expect` from here, not from
 * `@playwright/test`, so every spec gets `signedInPage` and the sign-in helpers.
 *
 * Sign-in never touches a mailbox: the spec asks the api for a magic link like the real form
 * does, then reads the link back from the test-only `GET /__test/last-magic-link` route (mounted
 * only under `NODE_ENV=test` + `ENABLE_TEST_ROUTES=1`, see apps/api/README.md) and visits it.
 */
import { type APIRequestContext, test as base, expect, type Page } from "@playwright/test";
import { demoWorkspace } from "@tj/editor/starter";
import { E2E_API_URL, E2E_WEB_URL } from "../playwright.config";

export { E2E_API_URL, E2E_WEB_URL };

/** A fresh address per test so specs never share a user (the e2e database is not truncated). */
export function uniqueEmail(prefix = "e2e"): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${rand}@example.test`;
}

/**
 * Ask the api to "send" a magic link for `email` exactly like the sign-in form does, including the
 * `errorCallbackURL` that sends a failed verification back to `/sign-in` (TEACH-68).
 */
export async function requestMagicLink(
  request: APIRequestContext,
  email: string,
  callbackPath = "/",
): Promise<void> {
  const errorCallbackURL = new URL("/sign-in", E2E_WEB_URL);
  errorCallbackURL.searchParams.set("redirect", callbackPath);
  const res = await request.post(`${E2E_API_URL}/auth/sign-in/magic-link`, {
    headers: { origin: E2E_WEB_URL },
    data: {
      email,
      callbackURL: `${E2E_WEB_URL}${callbackPath}`,
      errorCallbackURL: errorCallbackURL.toString(),
    },
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

/** The `data-element-id`s under the slide frame in DOM order (the slide's draw order). */
export async function elementIds(page: Page): Promise<string[]> {
  return page
    .locator("[data-slide-frame] [data-element-id]")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-element-id") ?? ""));
}

/**
 * The slide elements that were not in `before` (a snapshot from `elementIds`). Use it for "the
 * element just inserted" instead of `.last()`: a non-text element (shape, line, image) enters the
 * draw order beneath the slide's lowest text-like element (`insertIndex` in
 * `packages/editor/src/model/reducers/elements.ts`), so it is not the last `[data-element-id]`.
 */
export function addedElement(page: Page, before: string[]) {
  const not = before.map((id) => `:not([data-element-id="${id}"])`).join("");
  return page.locator(`[data-slide-frame] [data-element-id]${not}`);
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Demo-fixture key (`demo-water-cycle`, `series-romans`, …) → the uuid the seed gave it. */
export type SeedIds = Record<string, string>;

/**
 * Fill the signed-in user's Workspace with `demoWorkspace()` through the test-only
 * `POST /__test/seed-library` (ADR 0024 §16: Workspaces start empty). Uses `page.request` so the
 * session cookie travels; the `origin` header is what the api's CSRF guard checks.
 */
export async function seedLibrary(page: Page): Promise<SeedIds> {
  const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
    headers: { origin: E2E_WEB_URL },
    data: { documents: demoWorkspace(new Date()) },
  });
  expect(res.ok(), `POST /__test/seed-library failed: ${res.status()} ${await res.text()}`).toBe(
    true,
  );
  const body = (await res.json()) as { ids: SeedIds };
  return body.ids;
}

/** Route helpers over the seeded ids, so a spec reads `paths.lesson("demo-water-cycle")`. */
export function seededPaths(ids: SeedIds) {
  const id = (key: string): string => {
    const value = ids[key];
    if (!value) throw new Error(`seed has no document "${key}"`);
    return value;
  };
  const keys = new Map(Object.entries(ids).map(([key, value]) => [value, key]));
  return {
    id,
    /** The demo key for a seeded id (`data-lesson-id` attributes carry ids), or the id itself. */
    key: (value: string | null): string => (value === null ? "" : (keys.get(value) ?? value)),
    lesson: (key: string, suffix: "" | "/view" | "/present" | "/print" = "") =>
      `/l/${id(key)}${suffix}`,
    worksheet: (key: string, suffix: "" | "/print" = "") => `/w/${id(key)}${suffix}`,
    series: (key: string) => `/series/${id(key)}`,
  };
}
export type SeededPaths = ReturnType<typeof seededPaths>;

export interface SignedIn {
  page: Page;
  email: string;
  /** The seeded ids; empty when the spec opted out with `test.use({ seed: false })`. */
  ids: SeedIds;
  paths: SeededPaths;
}

export const test = base.extend<{ signedInPage: SignedIn; seed: boolean }>({
  /** Whether `signedInPage` seeds the demo library first. Most specs assume the demo content. */
  seed: [true, { option: true }],
  /** A page whose browser context holds a valid session for a brand-new user, sitting on `/`. */
  signedInPage: async ({ page, request, seed }, use) => {
    const email = await signIn(page, request);
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    const ids = seed ? await seedLibrary(page) : {};
    if (seed) {
      // The library was fetched empty on landing; reload so the specs start from the seeded lists.
      await page.reload();
      await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    }
    await use({ page, email, ids, paths: seededPaths(ids) });
  },
});

export { expect };
