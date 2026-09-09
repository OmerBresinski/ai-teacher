/**
 * TEACH-214 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-214-screenshots.spec.ts`.
 *
 * The ten-slide fixture lesson laid out through `chooseVariant` and the catalogue, on two themes
 * (calm on Chalk, playful with a title photograph on Playground, which a three-word title
 * splits), one PNG per slide from the presenter, plus a seven-word title with a photograph on
 * Reading Room for the `photo-band`, so all nine variants are on the PR.
 */
import type { Lesson } from "@tj/domain/documents";
import { DEMO_LESSON_SPECS, demoLessonSlides, newLesson } from "@tj/editor/starter";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 } });
// Twenty-one presenter loads, each through the start gate.
test.setTimeout(240_000);

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
  // The photo-band title, for the one variant neither deck above picks: a longer title.
  const [title, ...rest] = DEMO_LESSON_SPECS;
  if (title?.kind !== "title") throw new Error("the fixture opens on a title");
  const band = fixtureLesson("t214-band", "reading-room", {
    titleImage: true,
    specs: [{ ...title, title: "The water cycle: where the rain comes from" }, ...rest],
  });
  expect(band.variants[0]).toBe("photo-band");
  documents.push({ key: "t214-band", kind: "lesson", body: band.lesson });

  const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
    headers: { origin: E2E_WEB_URL },
    data: { documents },
  });
  expect(res.ok(), `seed failed: ${res.status()} ${await res.text()}`).toBe(true);
  const { ids } = (await res.json()) as { ids: Record<string, string> };

  /** Open slide `n` on the stage: `?slide=` sets the slide, the start gate still asks. */
  const shoot = async (id: string | undefined, n: number, file: string) => {
    await page.goto(`/l/${id}/present?slide=${n}`);
    await page.getByRole("button", { name: "Stay in this window" }).click();
    await expect(page.locator('[data-slide-mode="present"]')).toHaveCount(1);
    await expect(page.getByRole("status").first()).toContainText(`Slide ${n} of`);
    await page.waitForTimeout(600);
    await page.screenshot({ path: file });
  };
  for (const deck of DECKS) {
    const variants = expected[deck.key] ?? [];
    for (let n = 1; n <= 10; n++) {
      const label = `${String(n).padStart(2, "0")}-${variants[n - 1] ?? "default"}`;
      await shoot(ids[deck.key], n, `/tmp/teach-214-${deck.themeId}-${label}.png`);
    }
  }
  await shoot(ids["t214-band"], 1, "/tmp/teach-214-reading-room-01-photo-band.png");
});
