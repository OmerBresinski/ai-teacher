import { E2E_WEB_URL, expect, signIn, test, uniqueEmail } from "./fixtures";

test.use({ screenshot: "off" });

test("transient /me failures preserve an active editor and pending local work", async ({
  signedInPage: { page, paths },
}) => {
  const path = paths.lesson("demo-water-cycle");
  await page.goto(path);
  await expect(page.locator("[data-slide-frame]").first()).toBeVisible();
  let failures = 0;
  let failedTwice!: () => void;
  const retried = new Promise<void>((resolve) => {
    failedTwice = resolve;
  });
  await page.route("**/me", async (route) => {
    await route.fulfill({
      status: 500,
      headers: {
        "access-control-allow-origin": E2E_WEB_URL,
        "access-control-allow-credentials": "true",
      },
      json: { error: { code: "internal", message: "Synthetic outage" } },
    });
    if (++failures >= 2) failedTwice();
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await retried;
  await expect(page).toHaveURL(`${E2E_WEB_URL}${path}`);
  await expect(page.locator("[data-slide-frame]").first()).toBeVisible();
});

test("BFCache restoration revalidates a valid session and preserves the route", async ({
  signedInPage: { page, paths },
}) => {
  const path = paths.lesson("demo-water-cycle");
  await page.goto(path);
  await expect(page.locator("[data-slide-frame]").first()).toBeVisible();
  const checked = page.waitForResponse(
    (response) => response.url().endsWith("/me") && response.status() === 200,
  );
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
  );
  await checked;
  await expect(page).toHaveURL(`${E2E_WEB_URL}${path}`);
  await expect(page.locator("[data-slide-frame]").first()).toBeVisible();
});

test("logout in another tab clears the editor; B signs in without reloading A's tab", async ({
  signedInPage: { page, paths },
  context,
}) => {
  await page.goto(paths.lesson("demo-water-cycle"));
  await expect(page.locator("[data-slide-frame]").first()).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { sessionTestMarker: string }).sessionTestMarker = "same-document";
  });
  const other = await context.newPage();
  await other.goto("/lessons");
  const signedOut = other.waitForResponse((response) => response.url().endsWith("/auth/sign-out"));
  await other.getByRole("button", { name: "Sign out", exact: true }).click();
  expect((await signedOut).ok()).toBe(true);
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.locator("[data-slide-frame]")).toHaveCount(0);
  await signIn(other, other.request, uniqueEmail("session-b"), "/lessons");
  await expect(other.getByRole("heading", { name: "Lessons", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/lessons$/);
  await expect(page.getByRole("heading", { name: "Lessons", exact: true })).toBeVisible();
  await expect(page.locator("article")).toHaveCount(0);
  await page.getByRole("link", { name: /^Worksheets/ }).click();
  await expect(page.getByRole("heading", { name: "Worksheets", exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("tj:last-shell"))).toBe("/worksheets");
  expect(
    await page.evaluate(
      () => (window as unknown as { sessionTestMarker: string }).sessionTestMarker,
    ),
  ).toBe("same-document");
  await other.close();
});

test("an A Document response held past logout and B login cannot paint in B's tab", async ({
  signedInPage: { page, paths },
  context,
}) => {
  const other = await context.newPage();
  await other.goto("/lessons");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route(`**/documents/${paths.id("demo-water-cycle")}`, async (route) => {
    const response = await route.fetch(); // real authenticated A response from the local DB
    started();
    await held;
    await route.fulfill({ response }).catch(() => {}); // request may already have been aborted
  });
  try {
    await page.goto(paths.lesson("demo-water-cycle"), { waitUntil: "domcontentloaded" });
    await requested;
    const signedOut = other.waitForResponse((response) =>
      response.url().endsWith("/auth/sign-out"),
    );
    await other.getByRole("button", { name: "Sign out", exact: true }).click();
    await signedOut;
    await expect(page).toHaveURL(/\/sign-in/);
    await signIn(other, other.request, uniqueEmail("late-b"), "/lessons");
    await expect(page).toHaveURL(/\/lessons$/);
    release();
    await expect(page.getByRole("heading", { name: "Lessons", exact: true })).toBeVisible();
    await expect(page.locator("article")).toHaveCount(0);
    await expect(page.locator("[data-slide-frame]")).toHaveCount(0);
  } finally {
    release();
    await other.close();
  }
});

test("expiry and offline back navigation do not restore the private editor", async ({
  signedInPage: { page, paths },
  context,
}) => {
  await page.goto(paths.lesson("demo-water-cycle"));
  await expect(page.locator("[data-slide-frame]").first()).toBeVisible();
  await page.route("**/me", (route) =>
    route.fulfill({
      status: 401,
      headers: {
        "access-control-allow-origin": E2E_WEB_URL,
        "access-control-allow-credentials": "true",
      },
      json: { error: { code: "unauthorized", message: "Sign in again." } },
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page).toHaveURL(/\/sign-in/);
  await context.setOffline(true);
  await page.goBack().catch(() => {});
  await expect(page.locator("[data-slide-frame]")).toHaveCount(0);
  await context.setOffline(false);
});

test("failed signOut clears private data and reports that revocation was not confirmed", async ({
  signedInPage: { page },
}) => {
  await page.route("**/auth/sign-out", (route) =>
    route.fulfill({
      status: 500,
      headers: {
        "access-control-allow-origin": E2E_WEB_URL,
        "access-control-allow-credentials": "true",
      },
      json: { message: "synthetic sign-out failure" },
    }),
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("alert")).toContainText("Sign-out could not be confirmed");
  await expect(page.getByRole("button", { name: "Retry sign out" })).toBeVisible();
  await expect(page.locator("article")).toHaveCount(0);
});
