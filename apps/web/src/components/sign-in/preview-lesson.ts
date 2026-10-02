/**
 * The signed-out lesson a visitor asked to sign in from (TEACH-245). Kept per browser, so the tab
 * a magic link opens in finds it too, until the lesson opens for its new owner. When the claim is
 * declined (an existing account, ruling 112) the lesson 404s for the new user and this is the only
 * place its topic is left, for "Make it again in your account".
 */
export const PREVIEW_LESSON_KEY = "tj:preview-lesson";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type PreviewLesson = { lessonId: string; topic: string; at: number };

export function rememberPreviewLesson(lessonId: string, topic: string, now = Date.now()): void {
  try {
    localStorage.setItem(PREVIEW_LESSON_KEY, JSON.stringify({ lessonId, topic, at: now }));
  } catch {
    /* Storage can be blocked; the declined page then offers a blank brief. */
  }
}

export function previewLesson(lessonId: string, now = Date.now()): PreviewLesson | null {
  try {
    const raw = localStorage.getItem(PREVIEW_LESSON_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PreviewLesson>;
    if (
      value.lessonId !== lessonId ||
      typeof value.topic !== "string" ||
      typeof value.at !== "number" ||
      now - value.at > MAX_AGE_MS
    ) {
      return null;
    }
    return { lessonId: value.lessonId, topic: value.topic, at: value.at };
  } catch {
    return null;
  }
}

export function forgetPreviewLesson(): void {
  try {
    localStorage.removeItem(PREVIEW_LESSON_KEY);
  } catch {
    /* Nothing to forget. */
  }
}
