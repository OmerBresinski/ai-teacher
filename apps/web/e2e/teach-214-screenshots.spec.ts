/**
 * TEACH-214 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-214-screenshots.spec.ts`.
 *
 * The ten-slide fixture lesson laid out through `chooseVariant` and the catalogue, on two themes
 * (calm on Chalk, playful with a title photograph on Playground), one PNG per slide from the
 * presenter, plus the `split` title on Reading Room so all nine variants are on the PR.
 */
import type { Lesson } from "@tj/domain/documents";
import { demoLessonSlides, newLesson } from "@tj/editor/starter";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 } });

const DECKS = [
  { key: "t214-chalk", themeId: "chalk", personality: undefined, titleImage: false },
  { key: "t214-playground", themeId: "playground", personality: "playful", titleImage: true },
] as const;

function fixtureLesson(
  key: string,
  themeId: string,
  options: Parameters<typeof demoLessonSlides>[1],
) {
  const lesson: Lesson = { ...newLesson("The water cycle", themeId), id: key };
  const { slides, variants } = demoLessonSlides(themeId, options);
  lesson.slides = slides;
  return { lesson, variants };
}

test("captures the fixture lesson through chooseVariant on two themes", async ({
  signedInPage: { page },
}) => {
  await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
  const documents = [];
  const expected: Record<string, string[]> = {};
  for (const deck of DECKS) {
    const { lesson, variants } = fixtureLesson(deck.key, deck.themeId, {
      personality: deck.personality,
      titleImage: deck.titleImage,
    });
    expected[deck.key] = variants;
    documents.push({ key: deck.key, kind: "lesson", body: lesson });
  }
  // The split title, for the one variant neither deck above picks.
  const split = fixtureLesson("t214-split", "reading-room", { titleImage: true });
  expect(split.variants[0]).toBe("split");
  documents.push({ key: "t214-split", kind: "lesson", body: split.lesson });

  const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
    headers: { origin: E2E_WEB_URL },
    data: { documents },
  });
  expect(res.ok(), `seed failed: ${res.status()} ${await res.text()}`).toBe(true);
  const { ids } = (await res.json()) as { ids: Record<string, string> };

  for (const deck of DECKS) {
    const variants = expected[deck.key] ?? [];
    for (let n = 1; n <= 10; n++) {
      await page.goto(`/l/${ids[deck.key]}/present?slide=${n}`);
      const slide = page.locator('[data-slide-mode="present"]');
      await expect(slide).toHaveCount(1);
      await page.waitForTimeout(600);
      const label = `${String(n).padStart(2, "0")}-${variants[n - 1] ?? "default"}`;
      await page.screenshot({ path: `/tmp/teach-214-${deck.themeId}-${label}.png` });
    }
  }
  await page.goto(`/l/${ids["t214-split"]}/present?slide=1`);
  await expect(page.locator('[data-slide-mode="present"]')).toHaveCount(1);
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/tmp/teach-214-reading-room-01-split.png" });
});
