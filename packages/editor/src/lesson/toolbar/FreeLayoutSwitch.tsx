import { isLayoutGroup, type Slide } from "@tj/domain/documents";
import { Switch, toast } from "@tj/ui";
import { useId } from "react";
import { PanelLabel, PanelSeparator } from "../../kit/Panel";
import * as reducers from "../../model/reducers";
import { useHistory } from "../document-context";
import { useSessionActions } from "../use-editor-session";

export const FREE_ON_NOTICE =
  "Free layout: every box now moves, resizes and restyles on its own. Turn it off to tidy the layout again.";
export const FREE_OFF_NOTICE =
  "Layout tidied. Your words are kept; moves, sizes and colours went back to the layout's.";

/**
 * "Free layout" (TEACH-205 part b): off, an adaptive layout keeps its invisible structure (words
 * typed on the slide re-flow it; add and delete re-flow it). On, it is taken apart into ordinary
 * boxes the teacher can drag, resize and restyle anywhere, as in Chalkie. Turning it off again
 * lays it out from its template where it was, keeping the words. Shown on a layout group's toolbar
 * and on the slide toolbar of a slide that has a layout or a freed one.
 */
export function FreeLayoutSwitch({
  slide,
  separator = "after",
}: {
  slide: Slide;
  separator?: "after" | "before";
}) {
  const history = useHistory();
  const { select } = useSessionActions();
  const id = useId();
  const group = slide.elements.find(isLayoutGroup);
  const free = Boolean(slide.freeLayout);
  if (!free && !group) return null;

  const turn = async (on: boolean) => {
    if (on && group) {
      const out = history.dispatch(reducers.freeLayout, slide.id, group.id);
      if (out?.refused) toast(out.refused);
      else {
        select([]);
        toast(FREE_ON_NOTICE);
      }
      return;
    }
    if (!on && free) {
      const kit = await import("@tj/slides/relayout");
      const out = history.dispatch(reducers.tidyLayout, slide.id, kit);
      if (out?.refused) toast(out.refused);
      else {
        if (out?.id) select([out.id]);
        toast(FREE_OFF_NOTICE);
      }
    }
  };

  const control = (
    <>
      <PanelLabel id={`${id}-free`}>Free layout</PanelLabel>
      <Switch
        checked={free}
        onCheckedChange={(on) => void turn(on)}
        aria-labelledby={`${id}-free`}
        data-free-layout
      />
    </>
  );
  return separator === "before" ? (
    <>
      <PanelSeparator />
      {control}
    </>
  ) : (
    <>
      {control}
      <PanelSeparator />
    </>
  );
}
