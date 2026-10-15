import { isLayoutGroup } from "@tj/domain/documents";
import { type ComponentProps, lazy, Suspense } from "react";
import type { FreeLayoutSwitch as Switch } from "./FreeLayoutSwitch";

/*
 * The "Free layout" switch, loaded only for a slide with a layout (bundle budget, TEACH-205 part b).
 * The lesson history starts the same load when the lesson opens with a layout
 * (`model/layout-editing.ts`), so by the time a toolbar shows it the chunk is normally here.
 */
const FreeLayoutSwitch = lazy(() =>
  import("./FreeLayoutSwitch").then((m) => ({ default: m.FreeLayoutSwitch })),
);

export function LazyFreeLayoutSwitch(props: ComponentProps<typeof Switch>) {
  const { slide } = props;
  if (!slide.freeLayout && !slide.elements.some(isLayoutGroup)) return null;
  return (
    <Suspense fallback={null}>
      <FreeLayoutSwitch {...props} />
    </Suspense>
  );
}
