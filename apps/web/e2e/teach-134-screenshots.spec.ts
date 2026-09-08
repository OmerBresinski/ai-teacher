/** TEACH-134 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-134-screenshots.spec.ts`. */
import type { Page } from "@playwright/test";
import { generatedLesson, generatedWorksheet } from "@tj/domain/documents/fixtures";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 }, seed: false });

async function seedGenerated(page: Page): Promise<string> {
  const now = new Date().toISOString();
  const seed = async (documents: unknown[]) => {
    const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
      headers: { origin: E2E_WEB_URL },
      data: { documents },
    });
    expect(res.ok(), await res.text()).toBe(true);
    return ((await res.json()) as { ids: Record<string, string> }).ids;
  };
  const { worksheet } = await seed([
    { key: "worksheet", kind: "worksheet", body: { ...generatedWorksheet(), updatedAt: now } },
  ]);
  const { lesson } = await seed([
    {
      key: "lesson",
      kind: "lesson",
      body: { ...generatedLesson(), updatedAt: now, artefacts: { worksheetId: worksheet } },
    },
  ]);
  if (!lesson) throw new Error("seed");
  return lesson;
}

test("captures the facts panel, the cascade toast and the regenerate dialog", async ({
  signedInPage: { page },
}) => {
  const lessonId = await seedGenerated(page);
  await page.goto(`/l/${lessonId}`);
  await expect(page.getByRole("heading", { level: 1, name: "The water cycle" })).toBeVisible();
  await page.getByRole("button", { name: "Facts" }).click();
  const panel = page.getByRole("complementary", { name: "Facts" });
  await expect(panel).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-134-facts-panel.png" });

  const objective = panel.getByRole("textbox", { name: "Objective 1" });
  await objective.fill("Describe the water cycle in order");
  await objective.press("Enter");
  await expect(page.getByText("Auto changed on slide 4 and the worksheet to match")).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "/tmp/teach-134-cascade-toast.png" });

  const rail = page.getByRole("listbox", { name: "Slides" });
  await rail.getByRole("option").nth(1).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Regenerate slide…" }).click();
  await expect(page.getByRole("dialog", { name: "Regenerate slide 2" })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-134-regenerate.png" });
});
