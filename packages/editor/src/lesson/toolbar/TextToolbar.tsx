import type { Editor } from "@tiptap/core";
import type { TextElement, TextPreset, Theme } from "@tj/domain/documents";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
} from "@tj/ui";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Italic,
  Link2,
  List,
  ListOrdered,
  Underline,
} from "lucide-react";
import { memo, type ReactNode, useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ColorPicker } from "../../kit/Color";
import { Panel, PanelSeparator } from "../../kit/Panel";
import * as reducers from "../../model/reducers";
import { useEditSession } from "../../model/use-edit-session";
import { fontFloor, resolveTextStyle } from "../../slide/elements/kit";
import { useActiveEditor } from "../../text/active-editor";
import {
  type DocMark,
  docHasMark,
  docListType,
  type ListType,
  setDocList,
  toggleDocMark,
} from "../../text/doc-marks";
import { docLinkHref, normaliseHref, setDocLink } from "../../text/links";
import { useHistory } from "../document-context";
import { useSessionUi } from "../use-editor-session";

/*
 * The text toolbar (TeachDeck `components/v2/editor/toolbar/TextToolbar.tsx`): preset, size,
 * colour, bold / italic / underline, link, list, alignment. Two modes, one shape: with a caret it
 * drives the live Tiptap editor (`useActiveEditor`), and with the box merely selected it rewrites
 * the stored doc through the pure `doc-marks` / `links` helpers. `@tj/ui` twins throughout
 * (ADR 0022 §2); the "More" drawer (line height, face, height) arrives with TEACH-105.
 */

const PRESETS: { value: TextPreset; label: string }[] = [
  { value: "title", label: "Title" },
  { value: "heading", label: "Heading" },
  { value: "body", label: "Body" },
  { value: "caption", label: "Caption" },
];

const TOO_SMALL = "Won’t be readable from the back of the room";
/** TeachDeck's copy for a refused address. */
export const BAD_LINK = "Links can only go to a web page or an email address.";

/** Marks the link popover's own form, so ⌘K inside it stays out of the way. */
const LINK_PANEL = "data-link-panel";

/** Nothing legible needs more, and a 400pt body would blow the box apart. */
const MAX_FONT_SIZE = 200;

const ICON = { size: 20, strokeWidth: 1.5 } as const;

/** Re-render the toolbar whenever the live editor's state could have changed. */
function useEditorTick(editor: Editor | null) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!editor) return;
    editor.on("transaction", bump);
    editor.on("selectionUpdate", bump);
    return () => {
      editor.off("transaction", bump);
      editor.off("selectionUpdate", bump);
    };
  }, [editor]);
}

export function TextToolbar({
  element,
  theme,
  slideId,
}: {
  element: TextElement;
  theme: Theme;
  slideId: string;
}) {
  const { editingTextId } = useSessionUi();
  const active = useActiveEditor();
  const history = useHistory();
  const { run } = useEditSession(history);
  const editor =
    editingTextId === element.id && active.elementId === element.id ? active.editor : null;
  useEditorTick(editor);

  const r = resolveTextStyle(element.style, theme);
  const size = Math.round(r.fontSize);
  // The projector minimum for what this text is doing, not one flat number (`lib/model/themes`).
  const floor = fontFloor(r.preset, r.role);
  const atFloor = size <= floor;
  const atCeiling = size >= MAX_FONT_SIZE;

  const setStyle = (patch: Partial<TextElement["style"]>) =>
    history.dispatch(reducers.updateElement, slideId, element.id, {
      style: { ...element.style, ...patch },
    } as Partial<TextElement>);
  const setDoc = (doc: TextElement["doc"]) =>
    history.dispatch(reducers.updateElement, slideId, element.id, { doc } as Partial<TextElement>);

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
    setDoc(toggleDocMark(element.doc, mark));
  };

  const list: ListType | null = editor
    ? editor.isActive("bulletList")
      ? "bulletList"
      : editor.isActive("orderedList")
        ? "orderedList"
        : null
    : docListType(element.doc);

  const setList = (next: ListType | null) => {
    if (editor) {
      const chain = editor.chain().focus();
      if (next === "bulletList") chain.toggleBulletList().run();
      else if (next === "orderedList") chain.toggleOrderedList().run();
      else chain.liftListItem("listItem").run();
      return;
    }
    setDoc(setDocList(element.doc, next));
  };

  const align = r.align;
  const setAlign = (next: "left" | "center" | "right") => {
    // One write, one scope: through the editor it aligns the selected paragraphs, otherwise the box.
    if (editor) editor.chain().focus().setTextAlign(next).run();
    else setStyle({ align: next });
  };

  const setColor = (hex: string) => {
    if (editor) editor.chain().focus().setColor(hex).run();
    else run(() => setStyle({ color: hex }));
  };

  /* --- Link ------------------------------------------------------- */

  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const urlField = useRef<HTMLInputElement | null>(null);

  // With a caret, the toolbar reports the link under it; with the box merely selected, the first
  // link in the box.
  const linkedHref = editor
    ? String(editor.getAttributes("link").href ?? "")
    : (docLinkHref(element.doc) ?? "");
  const hasLink = linkedHref !== "";

  const openLink = useCallback(() => {
    setHref(linkedHref);
    setLinkError(null);
    setLinkOpen(true);
  }, [linkedHref]);

  // ⌘K. Armed with a caret in the box and with the box merely selected, because the Link button
  // works in both states. Inside the popover it does nothing: re-opening would throw away the text.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "k") return;
      if ((e.target as Element | null)?.closest?.(`[${LINK_PANEL}]`)) return;
      e.preventDefault();
      openLink();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [openLink]);

  // The Popover focuses its own panel one render after mount; the field claims focus after that.
  useEffect(() => {
    if (!linkOpen) return;
    const frame = requestAnimationFrame(() => urlField.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [linkOpen]);

  const applyLink = (): boolean => {
    const url = normaliseHref(href);
    if (!url) {
      setLinkError(BAD_LINK);
      return false;
    }
    if (editor) {
      const chain = editor.chain().focus();
      // A caret inside a link edits that link; a selection links the words chosen; a bare caret
      // with nothing selected writes the address and links that.
      if (editor.isActive("link") || !editor.state.selection.empty) {
        chain.extendMarkRange("link").setLink({ href: url });
      } else {
        chain.insertContent({
          type: "text",
          text: url,
          marks: [{ type: "link", attrs: { href: url } }],
        });
      }
      chain.run();
      return true;
    }
    setDoc(setDocLink(element.doc, url));
    return true;
  };

  const removeLink = () => {
    if (editor) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    setDoc(setDocLink(element.doc, null));
  };

  const palette = [
    theme.colors.ink,
    theme.colors.muted,
    theme.colors.accent,
    theme.colors.accent2,
    theme.colors.correct,
    theme.colors.incorrect,
    theme.colors.surface,
    theme.colors.background,
  ];

  const AlignIcon = align === "center" ? AlignCenter : align === "right" ? AlignRight : AlignLeft;

  return (
    <Panel as="bar" role="toolbar" aria-label="Text" data-text-toolbar>
      <DropTrigger
        label="Text style"
        value={r.preset}
        text={PRESETS.find((p) => p.value === r.preset)?.label ?? "Body"}
      >
        {PRESETS.map((p) => (
          <DropdownMenuRadioItem
            key={p.value}
            value={p.value}
            onSelect={() => setStyle({ preset: p.value, fontSize: undefined })}
          >
            {p.label}
          </DropdownMenuRadioItem>
        ))}
      </DropTrigger>

      <PanelSeparator />

      <SizeStepper
        size={size}
        floor={floor}
        atFloor={atFloor}
        atCeiling={atCeiling}
        role={r.role}
        onStep={(next) => run(() => setStyle({ fontSize: next }))}
      />

      <PanelSeparator />

      <ColorPicker value={r.color} onChange={setColor} palette={palette} label="Text colour" />

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

      <Popover open={linkOpen} onOpenChange={(next) => (next ? openLink() : setLinkOpen(false))}>
        <PopoverTrigger asChild>
          <IconButton label="Link" active={hasLink}>
            <Link2 aria-hidden {...ICON} />
          </IconButton>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-3" aria-label="Link">
          <form
            {...{ [LINK_PANEL]: "" }}
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (applyLink()) setLinkOpen(false);
            }}
          >
            <Input
              ref={urlField}
              value={href}
              onChange={(e) => {
                setHref(e.target.value);
                setLinkError(null);
              }}
              placeholder="https://"
              aria-label="Link address"
              aria-invalid={linkError ? true : undefined}
              aria-describedby={linkError ? "tj-link-error" : undefined}
              spellCheck={false}
              autoComplete="off"
              className="h-8"
            />
            {linkError ? (
              <p id="tj-link-error" role="alert" className="m-0 text-destructive text-meta">
                {linkError}
              </p>
            ) : null}
            <div className="flex items-center gap-1.5">
              <Button type="submit" size="sm">
                Apply
              </Button>
              {hasLink ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setLinkOpen(false);
                    removeLink();
                  }}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          </form>
        </PopoverContent>
      </Popover>

      <PanelSeparator />

      <DropTrigger
        label="List style"
        value={list ?? "none"}
        icon={
          list === "orderedList" ? (
            <ListOrdered aria-hidden {...ICON} />
          ) : (
            <List aria-hidden {...ICON} />
          )
        }
      >
        <DropdownMenuRadioItem value="none" onSelect={() => setList(null)}>
          No list
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="bulletList" onSelect={() => setList("bulletList")}>
          Bulleted
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="orderedList" onSelect={() => setList("orderedList")}>
          Numbered
        </DropdownMenuRadioItem>
      </DropTrigger>

      <DropTrigger label="Alignment" value={align} icon={<AlignIcon aria-hidden {...ICON} />}>
        <DropdownMenuRadioItem value="left" onSelect={() => setAlign("left")}>
          Left
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="center" onSelect={() => setAlign("center")}>
          Centre
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="right" onSelect={() => setAlign("right")}>
          Right
        </DropdownMenuRadioItem>
      </DropTrigger>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The −/+ size control. The disabled button kills its own pointer events, so the tooltip needs a
 * live wrapper to hover — the only way the floor ever explains itself.
 */
const SizeStepper = memo(function SizeStepper({
  size,
  floor,
  atFloor,
  atCeiling,
  role,
  onStep,
}: {
  size: number;
  floor: number;
  atFloor: boolean;
  atCeiling: boolean;
  role: string;
  onStep: (next: number) => void;
}) {
  return (
    <>
      <Tooltip label={atFloor && role !== "caption" ? TOO_SMALL : "Smaller"}>
        <span className="inline-flex">
          <IconButton
            label="Smaller"
            noTooltip
            disabled={atFloor}
            onClick={() => onStep(Math.max(floor, size - 2))}
          >
            <span aria-hidden className="text-lead leading-none">
              −
            </span>
          </IconButton>
        </span>
      </Tooltip>
      <span data-tabular data-font-size className="w-7 text-center text-body text-foreground">
        {size}
      </span>
      <IconButton
        label="Larger"
        disabled={atCeiling}
        onClick={() => onStep(Math.min(MAX_FONT_SIZE, size + 2))}
      >
        <span aria-hidden className="text-lead leading-none">
          +
        </span>
      </IconButton>
    </>
  );
});

/** A text-or-icon trigger with a chevron, over a radio-group DropdownMenu. */
function DropTrigger({
  label,
  value,
  text,
  icon,
  children,
}: {
  /** The menu's name, and the trigger's when it shows an icon rather than text. */
  label: string;
  value: string;
  text?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={text ? `${label}, ${text}` : label}
          className="inline-flex h-8 items-center gap-0.5 rounded-control px-1.5 text-body text-foreground outline-none transition-colors duration-(--duration-fast) ease-(--ease-out-soft) hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-accent-active"
        >
          {icon ?? <span className="px-0.5">{text}</span>}
          <ChevronDown aria-hidden size={14} strokeWidth={1.5} className="text-ink-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" aria-label={label}>
        <DropdownMenuRadioGroup value={value}>{children}</DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
