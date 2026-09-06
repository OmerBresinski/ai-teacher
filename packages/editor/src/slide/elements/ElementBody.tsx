import type { SlideElement } from "@tj/domain/documents";
import type { ReactElement } from "react";
import { ELEMENT_VIEWS } from "./index";
import type { ElementViewProps } from "./kit";

/**
 * Dispatches to the renderer for an element's type. Unknown types render nothing rather
 * than throwing, so a lesson from a newer version still opens.
 */
export function ElementBody(props: ElementViewProps<SlideElement>) {
  const View = ELEMENT_VIEWS[props.element.type] as
    | ((p: ElementViewProps<SlideElement>) => ReactElement | null)
    | undefined;
  if (!View) return null;
  return <View {...props} />;
}
