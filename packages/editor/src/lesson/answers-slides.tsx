import { toast } from "@tj/ui";
import { EyeOff } from "lucide-react";
import { useCallback } from "react";
import { loadLayoutKit } from "../model/layout-kit";
import * as reducers from "../model/reducers";
import { useHistory } from "./document-context";
import { BarButton, ICON } from "./toolbar/shared";

/*
 * Hiding and showing the guard and Answers slides (ruling 260, TEACH-191 part e; Greg's Q10: B).
 * "Hide answers" sits on the toolbar of a selected guard or Answers slide; once they are hidden,
 * any slide's menu in the rail offers "Show answers slides" (`Navigator`), the rail being where
 * slides are added, copied and deleted.
 */

export const SHOW_ANSWERS_LABEL = "Show answers slides";
export const ANSWERS_HIDDEN_NOTICE =
  "Answers slides hidden. To bring them back, right-click a slide in the rail and choose Show answers slides.";
export const ANSWERS_HIDDEN_EDITED_NOTICE =
  "Answers slides hidden, with your changes kept. To bring them back, right-click a slide in the rail and choose Show answers slides.";
export const ANSWERS_SHOWN_NOTICE = "Answers slides added at the end of the lesson.";

/** Hide (false) or show (true) the guard and Answers slides in one undo step, with a notice. */
export function useSetAnswersSlides(): (on: boolean) => Promise<void> {
  const history = useHistory();
  return useCallback(
    async (on: boolean) => {
      // The builder loads with the layout code (bundle budget), as the theme picker loads it.
      const kit = await loadLayoutKit();
      const out = history.dispatch(reducers.setAnswersSlides, on, kit);
      if (!out || reducers.answersSlidesOn(out) !== on) return;
      toast(
        on
          ? ANSWERS_SHOWN_NOTICE
          : out.answersOff?.edited
            ? ANSWERS_HIDDEN_EDITED_NOTICE
            : ANSWERS_HIDDEN_NOTICE,
      );
    },
    [history],
  );
}

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
