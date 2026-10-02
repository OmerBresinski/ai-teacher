/**
 * TEACH-226 PR screenshots. Opt-in: `TEACH_SCREENSHOTS=1 … e2e/teach-226-screenshots.spec.ts`.
 *
 * Every slide kind, materialised from the generation fixtures plus a chunked teaching body and the
 * callout-row composition, shot in present on Chalk, Night Lab and Exam Hall; a lesson generated
 * and stored on master (`stored-master-lessons.json`, stamped at fit version 2) opened in the
 * editor for the first time and again after; and a true/false slide exported to PowerPoint on all
 * ten themes, for the tick and cross. Run it on `master` for "before" and on the branch for
 * "after".
 */
import { readFileSync } from "node:fs";
import type { Lesson, Slide } from "@tj/domain/documents";
import { materialiseSlide, newLesson } from "@tj/editor/starter";
import { E2E_API_URL, E2E_WEB_URL, expect, test } from "./fixtures";

test.skip(process.env.TEACH_SCREENSHOTS !== "1", "Visual-reference screenshots are opt-in.");
test.use({ viewport: { width: 1440, height: 1000 } });
test.setTimeout(900_000);

const THEMES = ["chalk", "night-lab", "exam-hall"] as const;
const ALL_THEMES = [
  "chalk",
  "playground",
  "crayon",
  "splash",
  "treehouse",
  "reading-room",
  "studio",
  "exam-hall",
  "night-lab",
  "beacon",
] as const;
const OUT = process.env.TEACH_226_OUT ?? "/tmp/teach-226";
const META = { promptVersion: "e2e", model: "fixture", at: "2026-10-02T12:00:00.000Z" };

const repoFile = (path: string) =>
  JSON.parse(readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8")) as unknown;

/** The generation fixtures' spec for every kind (`@tj/generation` `FIXTURES.slides`). */
const SPECS = repoFile("packages/generation/src/fixtures/slides.json") as Record<string, unknown>;

/** Specs beyond one per kind: a body in labelled chunks, and one idea over a common mistake. */
const EXTRA: { name: string; spec: unknown; variant?: string }[] = [
  {
    name: "content-chunks",
    spec: {
      kind: "content",
      factRefs: [],
      heading: "Particles in the three states",
      body: [
        "Solid: the particles touch in a fixed pattern and only vibrate.",
        "Liquid: the particles still touch but slide past each other.",
        "Gas: the particles are far apart and move quickly in every direction.",
      ].join("\n"),
    },
  },
  {
    name: "content-callout-row",
    variant: "callout-row",
    spec: {
      kind: "content",
      factRefs: [],
      heading: "Hyperinflation wiped out the savings of the middle classes",
      body: "By November 1923 prices doubled every few days, so a lifetime of savings could not buy a loaf of bread.",
      callout: {
        kind: "watch-out",
        text: "Hyperinflation did not hurt everyone: people with large debts paid them off with worthless marks.",
      },
    },
  },
];

type Shot = { name: string; slide: Slide };

function shots(themeId: string): Shot[] {
  const out: Shot[] = [];
  const add = (name: string, spec: unknown, variant?: string) => {
    try {
      out.push({ name, slide: materialiseSlide(spec as never, themeId, META, undefined, variant) });
    } catch {
      // A variant this build does not have (callout-row before the port): no shot.
    }
  };
  for (const [kind, spec] of Object.entries(SPECS)) add(kind, spec);
  for (const extra of EXTRA) add(extra.name, extra.spec, extra.variant);
  return out;
}

type Stored = { name: string; themeId: string; slides: Slide[] };

/** Year 7 ratio, generated and stored on master: two worked examples, a starter, an exit ticket. */
function storedLesson(): Lesson {
  const { lessons } = repoFile("packages/slides/src/fixtures/stored-master-lessons.json") as {
    lessons: Stored[];
  };
  const stored = lessons.find((l) => l.name === "B-h-y7-ratio-p1");
  if (!stored) throw new Error("stored lesson");
  return {
    ...newLesson("TEACH-226 stored on master", stored.themeId),
    id: "t226-stored",
    slides: stored.slides,
    fitVersion: 2,
  };
}

function trueFalseLesson(themeId: string): Lesson {
  return {
    ...newLesson(`TEACH-226 true or false ${themeId}`, themeId),
    id: `t226-tf-${themeId}`,
    slides: [materialiseSlide(SPECS["true-false"] as never, themeId, META)],
  };
}

test("captures every kind in present, a stored lesson's first open and true/false PPTX", async ({
  signedInPage: { page },
}) => {
  await page.addInitScript(() => localStorage.setItem("tj-theme", "light"));
  const kinds: Record<string, Shot[]> = {};
  const documents: { key: string; kind: "lesson"; body: Lesson }[] = [];
  for (const themeId of THEMES) {
    kinds[themeId] = shots(themeId);
    const body: Lesson = {
      ...newLesson(`TEACH-226 ${themeId}`, themeId),
      id: `t226-${themeId}`,
      slides: (kinds[themeId] ?? []).map((s) => s.slide),
    };
    documents.push({ key: themeId, kind: "lesson", body });
  }
  documents.push({ key: "stored", kind: "lesson", body: storedLesson() });
  for (const themeId of ALL_THEMES)
    documents.push({ key: `tf-${themeId}`, kind: "lesson", body: trueFalseLesson(themeId) });
  const res = await page.request.post(`${E2E_API_URL}/__test/seed-library`, {
    headers: { origin: E2E_WEB_URL },
    data: { documents },
  });
  expect(res.ok(), `seed failed: ${res.status()} ${await res.text()}`).toBe(true);
  const { ids } = (await res.json()) as { ids: Record<string, string> };

  // A stored lesson's first open: the migration re-fits it once (a toast on the branch), and an
  // untouched generated slide gains no page.
  const stored = storedLesson();
  await page.goto(`/l/${ids.stored}`);
  const rows = page.getByRole("listbox", { name: "Slides" }).getByRole("option");
  await expect(page.locator('[data-slide-mode="edit"]').first()).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}-stored-first-open.png` });
  expect(await rows.count()).toBe(stored.slides.length);
  for (const slide of [3, 5, 8, 10]) {
    await rows.nth(slide - 1).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}-stored-editor-${slide}.png` });
  }
  await page.reload();
  await expect(page.locator('[data-slide-mode="edit"]').first()).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}-stored-second-open.png` });
  expect(await rows.count()).toBe(stored.slides.length);

  for (const themeId of THEMES) {
    const list = kinds[themeId] ?? [];
    for (const [i, shot] of list.entries()) {
      await page.goto(`/l/${ids[themeId]}/present?slide=${i + 1}`);
      await expect(page.locator('[data-slide-mode="present"]')).toHaveCount(1);
      await expect(page.getByRole("status").first()).toContainText(`Slide ${i + 1} of`);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}-${themeId}-${shot.name}.png` });
    }
  }

  for (const themeId of ALL_THEMES) {
    await page.goto(`/l/${ids[`tf-${themeId}`]}`);
    await expect(page.locator('[data-slide-mode="edit"]').first()).toBeVisible();
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export" });
    await dialog.getByRole("tab", { name: "PowerPoint" }).click();
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Export PowerPoint" }).click();
    await (await download).saveAs(`${OUT}-tf-${themeId}.pptx`);
    await page.keyboard.press("Escape");
  }
});
