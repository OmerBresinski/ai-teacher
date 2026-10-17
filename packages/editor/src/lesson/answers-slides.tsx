import type { Id, Lesson } from "@tj/domain/documents";
import { toast } from "@tj/ui";
import { EyeOff } from "lucide-react";
import { useCallback } from "react";
import { loadLayoutKit } from "../model/layout-kit";
import * as reducers from "../model/reducers";
import { useHistory } from "./document-context";
import { BarButton, ICON } from "./toolbar/shared";

/*
 * Hiding and showing the guard and Answers slides (ruling 260, TEACH-191 part e; Greg's Q10: B).
 * "Hide answers" sits on the toolbar of a selected guard or Answers slide, and deleting a guard or
 * Answers slide (the rail's Delete key and menu, the canvas's Delete slide) does the same, so the
 * slides are always kept and can come back. The way back: the notice's Show button, the rail's
 * Add slide picker, and any slide's menu in the rail.
 */

export const SHOW_ANSWERS_LABEL = "Show answers slides";
export const SHOW_ANSWERS_ACTION = "Show";
export const ANSWERS_HIDDEN_NOTICE =
  "Answers slides hidden. You can bring them back from Add slide.";
export const ANSWERS_HIDDEN_EDITED_NOTICE =
  "Answers slides hidden, with your changes kept. You can bring them back from Add slide.";
export const ANSWERS_HIDDEN_NOTE = "Answers slides are hidden.";
export const ANSWERS_SHOWN_NOTICE = "Answers slides added at the end of the lesson.";

/** The hidden notice stays long enough to reach its Show button. */
const HIDDEN_NOTICE_MS = 8000;

/**
 * Hide (false) or show (true) the guard and Answers slides in one undo step, with a notice. A
 * delete that takes plain slides along passes them as `alsoDelete`: they go in the same step.
 * Resolves to the lesson after the change (or null when nothing changed).
 */
export function useSetAnswersSlides(): (
  on: boolean,
  alsoDelete?: readonly Id[],
) => Promise<Lesson | null> {
  const history = useHistory();
  return useCallback(
    async function apply(on: boolean, alsoDelete: readonly Id[] = []) {
      // The builder loads with the layout code (bundle budget), as the theme picker loads it.
      const kit = await loadLayoutKit();
      const token = history.beginTransaction();
      for (const id of alsoDelete) history.dispatch(reducers.deleteSlide, id);
      const out = history.dispatch(reducers.setAnswersSlides, on, kit);
      history.endTransaction(token);
      if (!out || reducers.answersSlidesOn(out) !== on) return null;
      if (on) toast(ANSWERS_SHOWN_NOTICE);
      else
        toast(out.answersOff?.edited ? ANSWERS_HIDDEN_EDITED_NOTICE : ANSWERS_HIDDEN_NOTICE, {
          duration: HIDDEN_NOTICE_MS,
          action: { label: SHOW_ANSWERS_ACTION, onClick: () => void apply(true) },
        });
      return out;
    },
    [history],
  );
}

/** True when any of these slides is the guard or an Answers slide: deleting them hides answers. */
export const touchesAnswers = (lesson: Lesson, ids: readonly Id[]): boolean =>
  ids.some((id) => lesson.slides.some((s) => s.id === id && s.answersRole));

/** "Hide answers" on the toolbar of a guard or Answers slide. */
export function HideAnswersButton() {
  const set = useSetAnswersSlides();
  return (
    <BarButton data-hide-answers onClick={() => void set(false)}>
      <EyeOff {...ICON} />
      Hide answers
    </BarButton>
  );
}
