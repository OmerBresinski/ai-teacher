import type { SlotSide } from "@tj/slides";
import { PanelSeparator } from "../../kit/Panel";
import { Segmented } from "../../kit/Segmented";
import * as reducers from "../../model/reducers";
import { useHistory } from "../document-context";

/**
 * Which side of a teaching slide's words its slot takes (R2): the photo, the diagram zone, or the
 * figure that fills it. One write through `slotSide`, one undo step. Leads the element's toolbar.
 */
export function SlotSideControl({
  slideId,
  side,
  label,
}: {
  slideId: string;
  side: SlotSide;
  /** "Picture" for a photo, "Diagram" for a diagram zone. */
  label: string;
}) {
  const history = useHistory();
  return (
    <>
      <span className="px-1 text-ink-3 text-meta" aria-hidden>
        {label}
      </span>
      <Segmented
        aria-label={`${label} side`}
        value={side}
        onChange={(next) => history.dispatch(reducers.setSlotSide, slideId, next)}
        options={[
          { value: "left", label: "Left" },
          { value: "right", label: "Right" },
        ]}
      />
      <PanelSeparator />
    </>
  );
}

/** The control's props for an element that is its slide's slot, else `undefined`. */
export type SlotSideProps = { side: SlotSide; label: string };
