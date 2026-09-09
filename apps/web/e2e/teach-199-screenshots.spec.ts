/**
 * TEACH-199 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-199-screenshots.spec.ts`.
 * Planning is a seeded lock with no slides (the state before the first persist); writing is
 * caught from a real run over the fake worker, so the shot shows what the shell does on live
 * events. Checking lasts one coalesced event on the fake worker (90 and 100 land in the same
 * 250ms window), so that shot comes from the kit exhibit: `teach-199-kit.spec.ts` under
 * `E2E_KIT=1 --project=kit`.
 */
import { demoWorkspace } from "@tj/editor/starter";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 }, seed: false });

test("planning: the title in Lora on the canvas ground, Planning live", async ({
  signedInPage: { page },
}) => {
  const water = demoWorkspace(new Date()).find((d) => d.key === "demo-water-cycle");
  if (!water || !("slides" in water.body)) throw new Error("fixture missing");
  const body = { ...water.body, slides: [], updatedAt: new Date().toISOString() };
  delete (body as { facts?: unknown }).facts;
  const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
    headers: { origin: E2E_WEB_URL },
    data: {
      documents: [{ ...water, body, generatingJobId: "01a06a15-1849-7000-ac6a-c07e27fe308b" }],
    },
  });
  expect(res.ok()).toBe(true);
  const { ids } = (await res.json()) as { ids: Record<string, string> };

  await page.goto(`/l/${ids["demo-water-cycle"]}`);
  await expect(page.getByTestId("generating-stage")).toHaveText("Planning");
  await expect(page.getByText("Planning your lesson")).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-199-planning.png" });
});

test("writing, caught from a run over the fake worker", async ({ signedInPage: { page } }) => {
  await page.goto("/lessons/new");
  await page.getByRole("textbox", { name: "Topic or objective" }).fill("Rivers and flooding");
  await page.getByRole("combobox", { name: "Year group" }).click();
  await page.getByRole("option", { name: "Year 6" }).click();
  await page.getByRole("button", { name: "Plan it" }).click();
  await expect(page).toHaveURL(/\/l\/[0-9a-f-]{36}$/);

  const stage = page.getByTestId("generating-stage");
  await expect(stage).toContainText(/Writing the slides, [2-9] of/, { timeout: 30_000 });
  await page.screenshot({ path: "/tmp/teach-199-writing.png" });
});
