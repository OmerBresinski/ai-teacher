/**
 * What the brief remembers between lessons (TEACH-177 item 1): the subject, year group and theme
 * of the last lesson planned in this browser, so the next brief opens with the class already
 * set and says so. One `localStorage` key, every access behind try/catch — a private window, a
 * blocked storage API or a corrupt value all read as "nothing stored" and the form renders empty.
 */

/** Browser storage key; a stable client contract beside `tj:library:*` (see apps/web/AGENTS.md). */
export const LAST_CLASS_KEY = "tj:brief:last-class";

export type LastClass = {
  subject: string;
  subjectOther: string;
  yearGroup: string;
  themeId: string;
};

function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function readLastClass(): LastClass | null {
  try {
    const raw = globalThis.localStorage?.getItem(LAST_CLASS_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const subject = isString(record.subject) ? record.subject : "";
    const subjectOther = isString(record.subjectOther) ? record.subjectOther : "";
    const yearGroup = isString(record.yearGroup) ? record.yearGroup : "";
    const themeId = isString(record.themeId) ? record.themeId : "";
    if (!subject && !yearGroup && !themeId) return null;
    return { subject, subjectOther, yearGroup, themeId };
  } catch {
    return null;
  }
}

export function writeLastClass(value: LastClass): void {
  try {
    globalThis.localStorage?.setItem(LAST_CLASS_KEY, JSON.stringify(value));
  } catch {
    // Storage is a convenience; the lesson was still created.
  }
}
