import type { Id, Lesson, Slide, SlideElement } from "@tj/domain/documents";
import { useEffect, useRef } from "react";
import { rectOf } from "../../model/geometry";
import * as reducers from "../../model/reducers";
import { useHistory } from "../document-context";
import { isInTextField, matchesBinding } from "../keys";
import { duplicateSlide } from "../slide-commands";
import { useSessionActions, useSessionRead } from "../use-editor-session";
import { NUDGE, NUDGE_BIG } from "./constants";
import { announce, isCanvasFocused, isPointerGestureActive } from "./gesture-state";
import { clampToStage } from "./hit-test";

/**
 * Custom event fired when the user pastes an image file onto the canvas. The images ticket
 * (TEACH-107) listens for it and inserts the image — the transform layer has no business touching
 * storage.
 */
export const PASTE_IMAGE_EVENT = "tj:paste-image";
export type PasteImageDetail = { file: File };

export type ShortcutGroup = "Selection" | "Edit" | "Arrange" | "History";

export type CanvasShortcut = {
  id: string;
  label: string;
  /** Binding strings (`keys.ts`); several mean "any of these". */
  keys: string[];
  group: ShortcutGroup;
  /** Handled through the browser's own `paste` event, so there is no key binding for it. */
  native?: boolean;
};

/** The canvas key map, for the shell's help sheet (TeachDeck `useCanvasKeys.ts` :42-64). */
export const CANVAS_SHORTCUTS: CanvasShortcut[] = [
  {
    id: "nudge",
    label: "Nudge 1pt",
    keys: ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"],
    group: "Edit",
  },
  {
    id: "nudge-big",
    label: "Nudge 10pt",
    keys: ["Shift+ArrowLeft", "Shift+ArrowRight", "Shift+ArrowUp", "Shift+ArrowDown"],
    group: "Edit",
  },
  { id: "delete", label: "Delete", keys: ["Delete", "Backspace"], group: "Edit" },
  // ⌘D with nothing selected duplicates the slide instead; the Slides group lists that.
  { id: "duplicate", label: "Duplicate the selection", keys: ["$mod+d"], group: "Edit" },
  { id: "select-all", label: "Select all", keys: ["$mod+a"], group: "Selection" },
  { id: "escape", label: "Exit text edit, then deselect", keys: ["Escape"], group: "Selection" },
  { id: "cycle", label: "Next / previous element", keys: ["Tab", "Shift+Tab"], group: "Selection" },
  { id: "group", label: "Group", keys: ["$mod+g"], group: "Arrange" },
  { id: "ungroup", label: "Ungroup", keys: ["$mod+Shift+g"], group: "Arrange" },
  { id: "lock", label: "Lock / unlock", keys: ["$mod+Shift+l"], group: "Arrange" },
  { id: "forward", label: "Bring forward", keys: ["$mod+BracketRight"], group: "Arrange" },
  { id: "backward", label: "Send backward", keys: ["$mod+BracketLeft"], group: "Arrange" },
  { id: "front", label: "Bring to front", keys: ["$mod+Shift+BracketRight"], group: "Arrange" },
  { id: "back", label: "Send to back", keys: ["$mod+Shift+BracketLeft"], group: "Arrange" },
  { id: "copy", label: "Copy", keys: ["$mod+c"], group: "Edit" },
  { id: "cut", label: "Cut", keys: ["$mod+x"], group: "Edit" },
  { id: "paste", label: "Paste", keys: ["$mod+v"], group: "Edit", native: true },
  { id: "snap", label: "Snap to guides on / off", keys: ["$mod+Shift+Semicolon"], group: "Edit" },
  { id: "undo", label: "Undo", keys: ["$mod+z"], group: "History" },
  { id: "redo", label: "Redo", keys: ["$mod+Shift+z"], group: "History" },
];

export type CanvasKeysOptions = {
  /** Whether the canvas region owns the keyboard. */
  enabled: boolean;
  lesson: Lesson;
  slide: Slide | undefined;
};

/**
 * Canvas keyboard handling (TeachDeck `useCanvasKeys`), on one `keydown` listener. It stays out of
 * the way whenever a form field or a text editor has focus (Escape is the single exception, so you
 * can always get out). A held arrow nudges inside one transaction until the last arrow is released,
 * so a diagonal nudge is one undo step.
 */
export function useCanvasKeys({ enabled, lesson, slide }: CanvasKeysOptions): void {
  const history = useHistory();
  const actions = useSessionActions();
  const read = useSessionRead();

  // "Latest value" refs: the listener is bound once per `enabled` flip and reads live data.
  const lessonRef = useRef(lesson);
  lessonRef.current = lesson;
  const slideRef = useRef(slide);
  slideRef.current = slide;
  const historyRef = useRef(history);
  historyRef.current = history;

  const nudging = useRef(false);
  /** Every arrow key currently held; releasing one must not end the run while another repeats. */
  const heldArrows = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;

    const selectedElements = (): SlideElement[] => {
      const s = slideRef.current;
      if (!s) return [];
      const sel = new Set(read().selection);
      return s.elements.filter((e) => sel.has(e.id));
    };
    const unlockedIds = (): Id[] =>
      selectedElements()
        .filter((e) => !e.locked)
        .map((e) => e.id);
    const slideId = () => slideRef.current?.id ?? "";

    const endNudge = () => {
      heldArrows.current.clear();
      if (!nudging.current) return;
      nudging.current = false;
      historyRef.current.endTransaction();
    };

    const nudge = (dx: number, dy: number, key: string) => {
      // A drag owns the same elements and the same transaction. Let it finish.
      if (isPointerGestureActive()) return;
      const els = selectedElements().filter((e) => !e.locked);
      if (els.length === 0) return;
      heldArrows.current.add(key);
      const h = historyRef.current;
      if (!nudging.current) {
        h.beginTransaction();
        nudging.current = true;
      }
      const sid = slideId();
      for (const el of els) {
        const r = rectOf(el);
        const p = clampToStage({ ...r, x: r.x + dx, y: r.y + dy });
        h.dispatch(reducers.updateElement, sid, el.id, { x: p.x, y: p.y });
      }
    };

    const cycle = (dir: 1 | -1) => {
      const els = slideRef.current?.elements ?? [];
      if (els.length === 0) return;
      const sel = read().selection;
      const last = sel[sel.length - 1];
      const cur = last ? els.findIndex((e) => e.id === last) : -1;
      const next =
        cur === -1
          ? dir === 1
            ? 0
            : els.length - 1
          : (((cur + dir) % els.length) + els.length) % els.length;
      const target = els[next];
      if (target) actions.select([target.id]);
    };

    const paste = () => {
      const clip = read().clipboard;
      if (!clip || clip.length === 0) return;
      const made = historyRef.current.dispatch(reducers.pasteElements, clip, slideId());
      if (!made) return;
      actions.select(made.ids);
      // Each paste lands 16pt further along, as TeachDeck's did.
      actions.copy(made.copies);
    };

    type Handler = (e: KeyboardEvent) => void;
    const bindings: [string, Handler][] = [
      ["ArrowLeft", (e) => nudge(-NUDGE, 0, e.key)],
      ["ArrowRight", (e) => nudge(NUDGE, 0, e.key)],
      ["ArrowUp", (e) => nudge(0, -NUDGE, e.key)],
      ["ArrowDown", (e) => nudge(0, NUDGE, e.key)],
      ["Shift+ArrowLeft", (e) => nudge(-NUDGE_BIG, 0, e.key)],
      ["Shift+ArrowRight", (e) => nudge(NUDGE_BIG, 0, e.key)],
      ["Shift+ArrowUp", (e) => nudge(0, -NUDGE_BIG, e.key)],
      ["Shift+ArrowDown", (e) => nudge(0, NUDGE_BIG, e.key)],
      [
        "Delete",
        () => historyRef.current.dispatch(reducers.deleteElements, slideId(), unlockedIds()),
      ],
      [
        "Backspace",
        () => historyRef.current.dispatch(reducers.deleteElements, slideId(), unlockedIds()),
      ],
      // The action pill offers ⌘D on Duplicate slide, so the binding has to be true from the canvas
      // as well: with elements selected it duplicates those, otherwise the slide itself.
      [
        "$mod+d",
        () => {
          const ids = unlockedIds();
          if (ids.length) {
            const made = historyRef.current.dispatch(reducers.duplicateElements, slideId(), ids);
            if (made?.ids.length) actions.select(made.ids);
            return;
          }
          const id = slideRef.current?.id;
          if (id) {
            duplicateSlide(
              { history: historyRef.current, lesson: lessonRef.current, session: actions },
              id,
            );
          }
        },
      ],
      [
        "$mod+a",
        () => {
          const s = slideRef.current;
          if (s) actions.select(s.elements.filter((e) => !e.locked).map((e) => e.id));
        },
      ],
      [
        "Escape",
        () => {
          if (read().editingTextId) actions.setEditingText(null);
          else actions.clearSelection();
        },
      ],
      // Tab is only ours to swallow while the canvas actually has focus; otherwise a keyboard user
      // could neither tab into the canvas nor out of it to the toolbar.
      ["Tab", () => cycle(1)],
      ["Shift+Tab", () => cycle(-1)],
      [
        "$mod+g",
        () => {
          const groupable = selectedElements().filter((e) => !e.locked && e.type !== "group");
          if (groupable.length < 2) {
            announce(
              unlockedIds().length === 0
                ? "Nothing to group."
                : "Group needs at least two unlocked, ungrouped elements.",
            );
            return;
          }
          const made = historyRef.current.dispatch(
            reducers.group,
            slideId(),
            groupable.map((e) => e.id),
          );
          if (made?.id) actions.select([made.id]);
          announce(made?.id ? `Grouped ${groupable.length} elements.` : "Nothing was grouped.");
        },
      ],
      [
        "$mod+Shift+g",
        () => {
          const h = historyRef.current;
          const freed: Id[] = [];
          h.beginTransaction();
          for (const el of selectedElements()) {
            if (el.type !== "group") continue;
            const made = h.dispatch(reducers.ungroup, slideId(), el.id);
            if (made) freed.push(...made.ids);
          }
          h.endTransaction();
          if (freed.length) actions.select(freed);
        },
      ],
      [
        "$mod+Shift+l",
        () => {
          const els = selectedElements();
          if (els.length === 0) return;
          const allLocked = els.every((e) => e.locked);
          historyRef.current.dispatch(
            reducers.updateElements,
            slideId(),
            els.map((e) => e.id),
            { locked: !allLocked },
          );
        },
      ],
      [
        "$mod+BracketRight",
        () => historyRef.current.dispatch(reducers.reorder, slideId(), read().selection, "forward"),
      ],
      [
        "$mod+BracketLeft",
        () =>
          historyRef.current.dispatch(reducers.reorder, slideId(), read().selection, "backward"),
      ],
      [
        "$mod+Shift+BracketRight",
        () => historyRef.current.dispatch(reducers.reorder, slideId(), read().selection, "front"),
      ],
      [
        "$mod+Shift+BracketLeft",
        () => historyRef.current.dispatch(reducers.reorder, slideId(), read().selection, "back"),
      ],
      ["$mod+c", () => actions.copy(selectedElements())],
      [
        "$mod+x",
        () => {
          const els = selectedElements();
          if (els.length === 0) return;
          actions.copy(els);
          historyRef.current.dispatch(reducers.deleteElements, slideId(), unlockedIds());
        },
      ],
      ["$mod+Shift+Semicolon", () => actions.toggleSnap()],
      ["$mod+z", () => historyRef.current.undo()],
      ["$mod+Shift+z", () => historyRef.current.redo()],
    ];

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      // Repeats are allowed (a held arrow keeps nudging) and only Escape escapes a focused field.
      if (isInTextField(e.target) && e.key !== "Escape") return;
      const hit = bindings.find(([binding]) => matchesBinding(e, binding));
      if (!hit) return;
      if (hit[0].endsWith("Tab") && !isCanvasFocused()) return;
      e.preventDefault();
      hit[1](e);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.key.startsWith("Arrow")) return;
      heldArrows.current.delete(e.key);
      // Only the *last* arrow released ends the run, so a diagonal nudge stays one undo step.
      if (heldArrows.current.size === 0) endNudge();
    };

    // A window blur eats the keyup, so the run would otherwise never close.
    const onBlur = () => endNudge();

    // ⌘V is handled through the native paste event so an image on the clipboard reaches the shell
    // instead of being swallowed.
    const onPaste = (e: ClipboardEvent) => {
      if (isInTextField(e.target)) return;
      const file = Array.from(e.clipboardData?.items ?? [])
        .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
        .map((i) => i.getAsFile())
        .find((f): f is File => !!f);
      if (file) {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent<PasteImageDetail>(PASTE_IMAGE_EVENT, { detail: { file } }),
        );
        return;
      }
      // Only claim the event once we know we can handle it: calling preventDefault first would
      // swallow text copied from another application.
      const internal = read().clipboard;
      if (internal && internal.length > 0) {
        e.preventDefault();
        paste();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("paste", onPaste);
      endNudge();
    };
  }, [enabled, actions, read]);
}
