import { pickerVariant, ThemePicker } from "@tj/editor/theme-picker";
import { useState } from "react";
// The previews are slides: the theme fonts and slide rules travel with the picker's chunk.
import "@tj/editor/styles/editor.css";

/** The blank lesson's theme step (decision 34): the editor's picker, in this dialog's state. */
export default function NewDocumentThemePicker({
  selectedId,
  onPick,
  title,
}: {
  selectedId: string;
  onPick: (themeId: string) => void;
  title: string;
}) {
  const [variant] = useState(pickerVariant);
  return <ThemePicker selectedId={selectedId} onPick={onPick} title={title} variant={variant} />;
}
