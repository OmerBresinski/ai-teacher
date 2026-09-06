/**
 * The editor kit (ADR 0022 §2): components with no `@tj/ui` twin that own document geometry or
 * editor chrome. Everything with a Radix twin — Dialog, DropdownMenu, Popover, Tooltip, Tabs,
 * Switch, Slider, Kbd, Button… — comes from `@tj/ui`. Each file's header says why it has no twin.
 */

export {
  ColorPicker,
  type ColorPickerProps,
  ColorSwatch,
  type ColorSwatchProps,
  normalizeHex,
  RECENT_COLORS_KEY,
} from "./Color";
export { clamp, format, round, snap } from "./math";
export { NumberInput, type NumberInputProps } from "./NumberInput";
export { Panel, PanelLabel, type PanelProps, PanelRow, PanelSeparator } from "./Panel";
export { Rail, RailButton, type RailButtonProps, type RailProps, RailSeparator } from "./Rail";
export { Segmented, type SegmentedOption, type SegmentedProps } from "./Segmented";
export { nextStep, ZoomControl, type ZoomControlProps, type ZoomValue } from "./ZoomControl";
