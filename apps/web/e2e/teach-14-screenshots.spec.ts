/**
 * TEACH-14 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-14-screenshots.spec.ts`.
 *
 * A Chalk lesson and an Exam Hall lesson, each with an open photo slot, an undrawn diagram slot and
 * a teacher's white text on an accent card, shot in present, the viewer, the library thumbnails and
 * the editor, and exported to PowerPoint. Run it on `master` for "before" and on the branch for
 * "after": slot briefs leave every view but the editor, and Exam Hall draws its white as its
 * surface colour.
 */
import type { Lesson, Slide, TextElement } from "@tj/domain/documents";
import { materialiseSlide, materialiseSlides, newLesson } from "@tj/editor/starter";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 } });
test.setTimeout(300_000);

const THEMES = ["chalk", "exam-hall"] as const;
const OUT = process.env.TEACH_14_OUT ?? "/tmp/teach-14";
const META = { promptVersion: "e2e", model: "fixture", at: "2026-10-02T12:00:00.000Z" };

const photoSlide = (themeId: string): Slide => {
  const [slide] = materialiseSlides(
    {
      kind: "content",
      heading: "Why did Rome invade?",
      body: "Rome wanted Britain for its metals, grain and slaves. Tin and silver paid for soldiers.",
      factRefs: [],
    },
    themeId,
    META,
    undefined,
    0,
    { photo: { subject: "Roman legionaries landing on a beach", mustShow: ["shields"] } },
  );
  if (!slide) throw new Error("no photo slot slide");
  return slide;
};

const diagramSlide = (themeId: string): Slide =>
  materialiseSlide(
    {
      kind: "content",
      heading: "The water cycle",
      body: "Water moves between the sea, the air and the land in a loop. The sun heats the sea and water evaporates.",
      diagram: "Cycle: evaporation → condensation → precipitation → collection",
      factRefs: [],
    },
    themeId,
    META,
  );

/** A teacher's slide: an accent card with white words on it (`#FFFFFF`, a theme token). */
const colourSlide = (themeId: string, accent: string): Slide => {
  const words: TextElement = {
    id: `t14-${themeId}-white`,
    type: "text",
    x: 120,
    y: 200,
    w: 720,
    h: 80,
    doc: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "White words on the accent card" }] },
      ],
    },
    style: { preset: "heading", color: "#FFFFFF", align: "center" },
  };
  return {
    id: `t14-${themeId}-colour`,
    kind: "blank",
    elements: [
      {
        id: `t14-${themeId}-card`,
        type: "shape",
        shape: "rounded",
        x: 96,
        y: 150,
        w: 768,
        h: 180,
        fill: accent,
      },
      words,
    ],
  };
};

function lessons(themeId: string, accent: string): Record<string, Lesson> {
  const full: Lesson = { ...newLesson(`TEACH-14 ${themeId}`, themeId), id: `t14-${themeId}` };
  full.slides = [photoSlide(themeId), diagramSlide(themeId), colourSlide(themeId, accent)];
  // The library's thumbnail is a lesson's first slide: one lesson leads with each slot.
  const diagramCover: Lesson = {
    ...newLesson(`TEACH-14 ${themeId} diagram cover`, themeId),
    id: `t14-${themeId}-diagram`,
  };
  diagramCover.slides = [diagramSlide(themeId)];
  return { [themeId]: full, [`${themeId}-diagram`]: diagramCover };
}

test("captures slot briefs and theme colours in present, view, library, editor and PPTX", async ({
  signedInPage: { page },
}) => {
  await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
  const accents: Record<string, string> = { chalk: "#C2410C", "exam-hall": "#1B3A8C" };
  const documents = THEMES.flatMap((t) =>
    Object.entries(lessons(t, accents[t] ?? "#000000")).map(([key, body]) => ({
      key,
      kind: "lesson",
      body,
    })),
  );
  const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
    headers: { origin: E2E_WEB_URL },
    data: { documents },
  });
  expect(res.ok(), `seed failed: ${res.status()} ${await res.text()}`).toBe(true);
  const { ids } = (await res.json()) as { ids: Record<string, string> };

  await page.goto("/lessons");
  await expect(page.getByText("TEACH-14 exam-hall diagram cover")).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}-library.png` });

  for (const themeId of THEMES) {
    const id = ids[themeId];
    for (const slide of [1, 2, 3]) {
      await page.goto(`/l/${id}/present?slide=${slide}`);
      await expect(page.locator('[data-slide-mode="present"]')).toHaveCount(1);
      await expect(page.getByRole("status").first()).toContainText(`Slide ${slide} of`);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}-${themeId}-present-${slide}.png` });
    }

    await page.goto(`/l/${id}/view`);
    await expect(page.locator('[data-slide-mode="view"]').first()).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}-${themeId}-view.png`, fullPage: true });

    await page.goto(`/l/${id}`);
    const rows = page.getByRole("listbox", { name: "Slides" }).getByRole("option");
    for (const slide of [1, 2]) {
      await rows.nth(slide - 1).click();
      await expect(page.locator('[data-slide-mode="edit"]').first()).toBeVisible();
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}-${themeId}-editor-${slide}.png` });
    }

    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export" });
    await dialog.getByRole("tab", { name: "PowerPoint" }).click();
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Export PowerPoint" }).click();
    await (await download).saveAs(`${OUT}-${themeId}.pptx`);
  }
});
