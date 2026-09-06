/**
 * The element renderer registry. One entry per `ElementType`; every renderer takes
 * `ElementViewProps` and fills the box the ElementFrame gives it.
 */

import type { ElementType } from "@tj/domain/documents";
import type { ReactElement } from "react";
import { EmbedView } from "./EmbedView";
import { GapTextView } from "./GapTextView";
import { GroupView } from "./GroupView";
import { IconView } from "./IconView";
import { ImageView } from "./ImageView";
import { LineView } from "./LineView";
import { OptionView } from "./OptionView";
import { ShapeView } from "./ShapeView";
import { TableView } from "./TableView";
import { TextView } from "./TextView";
import { TimerView } from "./TimerView";

// biome-ignore lint/suspicious/noExplicitAny: each view narrows `element` to its own type; the frame dispatches by `type`.
export const ELEMENT_VIEWS: Record<ElementType, (props: any) => ReactElement | null> = {
  text: TextView,
  image: ImageView,
  shape: ShapeView,
  line: LineView,
  icon: IconView,
  table: TableView,
  embed: EmbedView,
  option: OptionView,
  "gap-text": GapTextView,
  timer: TimerView,
  group: GroupView,
};

export { ElementBody } from "./ElementBody";
export { ElementFrame } from "./ElementFrame";
export { parseEmbed } from "./EmbedView";
export { ICON_NAMES, ICONS } from "./IconView";
export * from "./kit";
export { RichText } from "./RichText";
export { TextShell } from "./TextView";
export { formatClock, TimerFace } from "./TimerView";
export {
  EmbedView,
  GapTextView,
  GroupView,
  IconView,
  ImageView,
  LineView,
  OptionView,
  ShapeView,
  TableView,
  TextView,
  TimerView,
};
