/**
 * TEACH-101 part b: lessons made of the activity templates' fixture slides, with the cached photos
 * in `fixtures/activities/` served for `/files/act/<name>.jpg` (no network, no paid calls).
 */
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import type { Lesson, Slide } from "@tj/domain/documents";
import { activityFixtures, type FixturePhoto, layoutTemplate } from "@tj/editor/fixtures";
import { getTheme, newLesson } from "@tj/editor/starter";
import { E2E_API_URL } from "./fixtures";

export const PHOTO_DIR = new URL("./fixtures/activities/", import.meta.url);
/** Each fixture photo's shape and its real credit (Pexels or Wikimedia Commons, with licence). */
const CREDITS = JSON.parse(readFileSync(new URL("credits.json", PHOTO_DIR), "utf8")) as Record<
  string,
  Omit<FixturePhoto, "src">
>;
const photo = (name: string): FixturePhoto => ({ src: `/files/act/${name}.jpg`, ...CREDITS[name] });

/** Serves `/files/act/<name>.jpg` from the fixture photos. */
export async function servePhotos(page: Page) {
  await page.route(`${E2E_API_URL}/files/act/**`, (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    return route.fulfill({
      status: 200,
      contentType: "image/jpeg",
      body: readFileSync(new URL(name, PHOTO_DIR)),
    });
  });
}

/** One lesson per key stage: the six activity templates in catalogue order. */
export function activityLesson(stage: "ks1" | "ks4"): Lesson {
  const themeId = stage === "ks1" ? "splash" : "studio";
  const theme = getTheme(themeId);
  const fixtures = activityFixtures(photo).filter((f) => f.stage === stage);
  const base: Lesson = {
    ...newLesson(`Activities ${stage.toUpperCase()}`, themeId),
    id: `act-${stage}`,
  };
  base.slides = fixtures.map((f, i): Slide => {
    const r = layoutTemplate(f.input, theme, stage);
    return { id: `act-${stage}-${i + 1}`, ...r.slide, notes: "" } as Slide;
  });
  return base;
}

export const ACTIVITY_NAMES = ["pair", "group-sort", "sequence", "choose", "odd-one-out", "label"];
