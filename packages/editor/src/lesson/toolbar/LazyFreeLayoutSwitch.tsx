import { isLayoutGroup } from "@tj/domain/documents";
import { LazyPart, RetryLoad } from "../../kit/LazyPart";
import { type FreeLayoutSwitchProps, freeLayoutSwitch } from "./free-layout-loader";

/*
 * The "Free layout" switch, loaded only for a slide with a layout (bundle budget, TEACH-205 part b).
 * The lesson history starts the same load when the lesson opens with a layout
 * (`model/layout-editing.ts`), so by the time a toolbar shows it the chunk is normally here. A
 * failed load shows a retry in the switch's place; the rest of the toolbar stays up.
 */
export function LazyFreeLayoutSwitch(props: FreeLayoutSwitchProps) {
  const { slide } = props;
  if (!slide.freeLayout && !slide.elements.some(isLayoutGroup)) return null;
  return (
    <LazyPart
      loader={freeLayoutSwitch}
      props={props}
      fallback={null}
      failed={(retry) => <RetryLoad className="px-2 py-1" onRetry={retry} />}
    />
  );
}
