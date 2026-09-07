/** TEACH-121 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-121-screenshots.spec.ts`. */
import { demoWorkspace } from "@tj/editor/starter";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 900 } });

test("captures the seeded library, a server search and the generating banner", async ({
  signedInPage: { page },
}) => {
  await page.goto("/lessons");
  await expect(page.getByRole("link", { name: "Open The water cycle" })).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/tmp/teach-121-library.png" });

  await page.getByRole("searchbox", { name: "Search by title" }).fill("roman");
  await expect(page.getByRole("link", { name: /^Open / })).toHaveCount(3);
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-121-search.png" });

  const jobId = "01a06a15-1849-7000-ac6a-c07e27fe308b";
  const water = demoWorkspace(new Date()).find((d) => d.key === "demo-water-cycle");
  if (!water) throw new Error("fixture missing");
  const body = {
    ...water.body,
    id: "locked",
    title: "Volcanoes",
    updatedAt: new Date().toISOString(),
  };
  const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
    headers: { origin: E2E_WEB_URL },
    data: { documents: [{ key: "locked", kind: "lesson", body, generatingJobId: jobId }] },
  });
  const { ids } = (await res.json()) as { ids: Record<string, string> };
  await page.goto(`/l/${ids.locked}`);
  await expect(page.getByTestId("generating-banner")).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/tmp/teach-121-generating.png" });
});
