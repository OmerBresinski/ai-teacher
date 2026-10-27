import type { Lesson } from "@tj/domain/documents";
import { atKeyStage, getTheme } from "@tj/slides/themes";
import { hasOpenJobSlots, resolveOpenSlots } from "./open-slots";
import { stageOf } from "./write";

/**
 * TEACH-251 part av: a lesson no job is writing any more that still holds an open picture slot
 * (its worker died hard, so neither its failure path nor a retry laid the slot away). Returns the
 * lesson with every such slot laid away, the words across the slide, or undefined when there is
 * none. The api runs it when it reads a lesson no job holds, so no slot is left waiting forever.
 */
export async function healOpenSlots(lesson: Lesson): Promise<Lesson | undefined> {
  if (!Array.isArray(lesson.slides) || !hasOpenJobSlots(lesson.slides)) return undefined;
  const base = getTheme(lesson.themeId, null);
  // A lesson whose age band names no key stage is laid out in the theme as it is.
  let theme = base;
  try {
    theme = atKeyStage(base, stageOf(lesson.ageBand, lesson.yearGroup));
  } catch {}
  const { slides } = await resolveOpenSlots(lesson.slides, { theme });
  return { ...lesson, slides };
}
