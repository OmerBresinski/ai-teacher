/** TEACH-252 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-252-screenshots.spec.ts`. */
import type { LessonFacts } from "@tj/domain/documents";
import { demoWorkspace } from "@tj/editor/starter";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 }, seed: false });

const OUTLINE_KINDS = [
  "title",
  "objectives",
  "starter",
  "vocabulary",
  "content",
  "worked-example",
  "multiple-choice",
  "plenary",
] as const;
const FACTS: LessonFacts = {
  objectives: [],
  vocabulary: [],
  workedExamples: [],
  questions: [],
  misconceptions: [],
  outline: OUTLINE_KINDS.map((kind, i) => ({ id: `s${i + 1}`, kind, minutes: 7, factRefs: [] })),
  durationMin: 56,
};

test("captures the shell mid-generation with an earlier slide chosen", async ({
  signedInPage: { page },
}) => {
  const water = demoWorkspace(new Date()).find((d) => d.key === "demo-water-cycle");
  if (!water || !("slides" in water.body)) throw new Error("fixture missing");
  const body = {
    ...water.body,
    slides: water.body.slides.slice(0, 4),
    facts: FACTS,
    updatedAt: new Date().toISOString(),
  };
  const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
    headers: { origin: E2E_WEB_URL },
    data: {
      documents: [{ ...water, body, generatingJobId: "01a06a15-1849-7000-ac6a-c07e27fe308b" }],
    },
  });
  expect(res.ok()).toBe(true);
  const { ids } = (await res.json()) as { ids: Record<string, string> };

  await page.goto(`/l/${ids["demo-water-cycle"]}`);
  await expect(page.locator('nav[aria-label="Slides"] li[aria-hidden="true"]')).toHaveCount(4);
  await page.getByRole("button", { name: "Slide 2" }).click();
  await expect(page.getByRole("button", { name: "Newest slide" })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/teach-252-viewing.png" });
});
