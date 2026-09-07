import type { ShapeElement, TextPreset, Theme } from "@tj/domain/documents";
import { DropdownMenuRadioItem, IconButton } from "@tj/ui";
import { Bold, Italic, Underline } from "lucide-react";
import { ColorPicker } from "../../kit/Color";
import { fontFloor, resolveTextStyle } from "../../slide/elements/kit";
import { useActiveEditor } from "../../text/active-editor";
import { type DocMark, docHasMark, toggleDocMark } from "../../text/doc-marks";
import { isDocEmpty } from "../../text/static";
import { useSessionUi } from "../use-editor-session";
import { DropTrigger, ICON, useElementWrites, useThemePalette } from "./shared";
import { MAX_FONT_SIZE, PRESETS, SizeStepper, useEditorTick } from "./TextToolbar";

/**
 * The text controls a shape label gets once it has one (or while its editor is open): preset,
 * size, colour, bold / italic / underline, the same shapes as the text bar. They sit as a second
 * row inside the Label popover rather than on the bar: with them inline the shape bar runs past
 * 700px and collides with the selection's action cluster at 1280px. Preset, size and colour
 * write `element.textStyle` — the label is one run of text styled as a block, so there is no
 * per-character colour to keep — and the marks go through the live Tiptap editor with a caret, or
 * rewrite the stored doc with the box merely selected, exactly as `TextToolbar` does.
 */
export function LabelTextControls({
  element,
  theme,
  slideId,
}: {
  element: ShapeElement;
  theme: Theme;
  slideId: string;
}) {
  const { editingTextId } = useSessionUi();
  const active = useActiveEditor();
  const editing = editingTextId === element.id;
  const editor = editing && active.elementId === element.id ? active.editor : null;
  useEditorTick(editor);
  const { update, scrub } = useElementWrites(slideId);
  const palette = useThemePalette(theme);

  const hasLabel = element.doc !== undefined && !isDocEmpty(element.doc);
  if (!hasLabel && !editing) return null;

  // Mirror ShapeView so the readout is the size actually drawn.
  const r = resolveTextStyle(
    { align: "center", valign: "middle", padding: 12, ...element.textStyle },
    theme,
    element.textStyle?.preset ?? "body",
  );
  const size = Math.round(r.fontSize);
  const floor = fontFloor(r.preset, r.role);

  const setStyle = (patch: Partial<NonNullable<ShapeElement["textStyle"]>>) =>
    update<ShapeElement>(element.id, { textStyle: { ...element.textStyle, ...patch } });

  const isActive = (mark: DocMark) =>
    editor ? editor.isActive(mark) : docHasMark(element.doc, mark);
  const toggleMark = (mark: DocMark) => {
    if (editor) {
      const chain = editor.chain().focus();
      if (mark === "bold") chain.toggleBold().run();
      else if (mark === "italic") chain.toggleItalic().run();
      else chain.toggleUnderline().run();
      return;
    }
    if (element.doc) update<ShapeElement>(element.id, { doc: toggleDocMark(element.doc, mark) });
  };

  return (
    <div className="flex items-center gap-0.5" data-label-text-controls>
      <DropTrigger
        label="Label style"
        value={r.preset}
        text={PRESETS.find((p) => p.value === r.preset)?.label ?? "Body"}
        className="font-medium"
      >
        {PRESETS.map((p) => (
          <DropdownMenuRadioItem
            key={p.value}
            value={p.value}
            onSelect={() => setStyle({ preset: p.value as TextPreset, fontSize: undefined })}
          >
            {p.label}
          </DropdownMenuRadioItem>
        ))}
      </DropTrigger>
      <SizeStepper
        size={size}
        floor={floor}
        atFloor={size <= floor}
        atCeiling={size >= MAX_FONT_SIZE}
        role={r.role}
        onStep={(next) => scrub(() => setStyle({ fontSize: next }))}
      />
      <ColorPicker
        label="Label colour"
        value={r.color}
        palette={palette}
        onChange={(color) => setStyle({ color })}
      />
      <IconButton
        label="Bold"
        active={isActive("bold")}
        aria-pressed={isActive("bold")}
        onClick={() => toggleMark("bold")}
      >
        <Bold aria-hidden {...ICON} />
      </IconButton>
      <IconButton
        label="Italic"
        active={isActive("italic")}
        aria-pressed={isActive("italic")}
        onClick={() => toggleMark("italic")}
      >
        <Italic aria-hidden {...ICON} />
      </IconButton>
      <IconButton
        label="Underline"
        active={isActive("underline")}
        aria-pressed={isActive("underline")}
        onClick={() => toggleMark("underline")}
      >
        <Underline aria-hidden {...ICON} />
      </IconButton>
    </div>
  );
}
