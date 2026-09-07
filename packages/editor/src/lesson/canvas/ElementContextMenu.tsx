import type { Id, Slide, SlideElement } from "@tj/domain/documents";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@tj/ui";
import { useRef } from "react";
import * as reducers from "../../model/reducers";
import { useHistory } from "../document-context";
import { hint } from "../keys";
import {
  useSelection,
  useSessionActions,
  useSessionRead,
  useSessionUi,
} from "../use-editor-session";

/*
 * The canvas context menu (Chalkie's right-click). Two shapes: an element menu (copy, duplicate,
 * paste, the four draw-order moves, delete) and a shorter ground menu (paste, select all). Built on
 * the kit's DropdownMenu the way the Navigator's slide menu is: a controlled menu whose trigger is a
 * 1px anchor fixed at the pointer. The canvas decides *what* was hit (it owns the hit-test and the
 * selection); this file only renders the menu and wires each item to the reducer the keyboard
 * shortcut already calls, so the caps beside the items are the same bindings.
 */

export type CanvasMenuState = { x: number; y: number; kind: "element" | "ground" } | null;

export type ElementContextMenuProps = {
  slide: Slide;
  menu: CanvasMenuState;
  onClose: () => void;
  /** Where focus goes when the menu closes: the canvas region, so the keys keep working. */
  returnFocus: () => void;
};

/** True when every picked element already sits at the top (or bottom) of the draw order. */
export function isAtEdge(
  elements: readonly SlideElement[],
  ids: readonly Id[],
  edge: "top" | "bottom",
) {
  const picked = new Set(ids);
  const n = elements.filter((e) => picked.has(e.id)).length;
  if (n === 0) return true;
  const band = edge === "top" ? elements.slice(elements.length - n) : elements.slice(0, n);
  return band.every((e) => picked.has(e.id));
}

export function ElementContextMenu({ slide, menu, onClose, returnFocus }: ElementContextMenuProps) {
  const history = useHistory();
  const actions = useSessionActions();
  const read = useSessionRead();
  const selection = useSelection();
  const { clipboard } = useSessionUi();

  // The anchor keeps its last position after the menu closes: the content stays mounted for its
  // fade-out and would otherwise jump to the top-left corner for a frame.
  const last = useRef(menu);
  if (menu) last.current = menu;
  const at = menu ?? last.current;
  const kind = at?.kind ?? "element";

  const selected = () => {
    const sel = new Set(read().selection);
    return slide.elements.filter((e) => sel.has(e.id));
  };
  const unlockedIds = () =>
    selected()
      .filter((e) => !e.locked)
      .map((e) => e.id);

  const paste = () => {
    const clip = read().clipboard;
    if (!clip || clip.length === 0) return;
    const made = history.dispatch(reducers.pasteElements, clip, slide.id);
    if (!made) return;
    actions.select(made.ids);
    actions.copy(made.copies);
  };

  const reorder = (how: reducers.Reorder) =>
    history.dispatch(reducers.reorder, slide.id, read().selection, how);

  const canPaste = !!clipboard && clipboard.length > 0;
  const picked = selected();
  const [onlyPicked] = picked;
  const croppable =
    picked.length === 1 && onlyPicked?.type === "image" && !onlyPicked.locked ? onlyPicked : null;
  const topmost = isAtEdge(slide.elements, selection, "top");
  const bottommost = isAtEdge(slide.elements, selection, "bottom");

  return (
    <DropdownMenu open={menu !== null} onOpenChange={(o) => !o && onClose()}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          data-canvas-menu-anchor
          style={{ position: "fixed", left: at?.x ?? 0, top: at?.y ?? 0, width: 1, height: 1 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="start"
        aria-label={kind === "ground" ? "Slide" : "Element"}
        data-canvas-menu={kind}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          returnFocus();
        }}
      >
        {kind === "ground" ? (
          <>
            <DropdownMenuItem disabled={!canPaste} onSelect={paste}>
              Paste
              <DropdownMenuShortcut>{hint("$mod+v")}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={slide.elements.every((e) => e.locked)}
              onSelect={() =>
                actions.select(slide.elements.filter((e) => !e.locked).map((e) => e.id))
              }
            >
              Select all
              <DropdownMenuShortcut>{hint("$mod+a")}</DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => actions.copy(selected())}>
              Copy
              <DropdownMenuShortcut>{hint("$mod+c")}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={unlockedIds().length === 0}
              onSelect={() => {
                const made = history.dispatch(reducers.duplicateElements, slide.id, unlockedIds());
                if (made?.ids.length) actions.select(made.ids);
              }}
            >
              Duplicate
              <DropdownMenuShortcut>{hint("$mod+d")}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canPaste} onSelect={paste}>
              Paste
              <DropdownMenuShortcut>{hint("$mod+v")}</DropdownMenuShortcut>
            </DropdownMenuItem>
            {croppable ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => actions.enterCrop(croppable)}>
                  Crop image
                  <DropdownMenuShortcut>{hint("Enter")}</DropdownMenuShortcut>
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={topmost} onSelect={() => reorder("front")}>
              Bring to front
              <DropdownMenuShortcut>{hint("$mod+Shift+BracketRight")}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={topmost} onSelect={() => reorder("forward")}>
              Bring forward
              <DropdownMenuShortcut>{hint("$mod+BracketRight")}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={bottommost} onSelect={() => reorder("backward")}>
              Send backward
              <DropdownMenuShortcut>{hint("$mod+BracketLeft")}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={bottommost} onSelect={() => reorder("back")}>
              Send to back
              <DropdownMenuShortcut>{hint("$mod+Shift+BracketLeft")}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={unlockedIds().length === 0}
              onSelect={() => history.dispatch(reducers.deleteElements, slide.id, unlockedIds())}
            >
              Delete
              <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
