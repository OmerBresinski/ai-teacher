import type { GroupElement, Id, LayoutRef } from "@tj/domain/documents";
import * as kit from "@tj/slides/relayout";
import { Button, toast } from "@tj/ui";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Rect } from "../../model/geometry";
import * as reducers from "../../model/reducers";
import { renderTheme } from "../../model/themes";
import { useHistory, useLesson } from "../document-context";

/**
 * The items of an adaptive layout (TEACH-205 part b; UX rulings 215, 199). A group with a
 * `LayoutRef` is changed through its items, never box by box: each item's words, add and remove
 * re-lay the whole group from its template in one undo step. Ruling 215: a field over its
 * published cap shows a quiet counter ("92/80"); a field past the hard maximum is marked over and
 * the panel offers Split onto a second slide (where the layout has a continuation) and Shorten.
 *
 * Lazy: `SelectionLayer` loads it (and with it every template recipe) only when a layout group is
 * selected. It sits under the group's frame, counter-scaled so it reads at screen size.
 */
export default function LayoutPanel({
  slideId,
  group,
  rect,
  scale,
}: {
  slideId: Id;
  group: GroupElement & { layout: LayoutRef };
  rect: Rect;
  scale: number;
}) {
  const lesson = useLesson();
  const history = useHistory();
  const ref = group.layout;
  const spec = kit.ADAPTIVE_SPECS[ref.template];
  // `renderTheme` hands back one cached theme per id and stage, so this re-lays only when the ref
  // or the lesson's look changes, never on an unrelated edit.
  const theme = renderTheme(lesson);
  const ageBand = lesson.ageBand;
  const fields = useMemo(() => {
    try {
      return kit.relayout(ref, theme, kit.stageOf(theme, ageBand)).fields;
    } catch {
      return [];
    }
  }, [ref, theme, ageBand]);
  const byPath = new Map(fields.map((f) => [f.path, f]));
  const items = kit.itemsOf(ref);
  const over = fields.filter((f) => f.state === "over");
  const inputs = useRef(new Map<string, HTMLTextAreaElement>());
  const panelRef = useRef<HTMLDivElement>(null);
  /** Where to move focus once a removal has re-laid the items (the next item, or the new last). */
  const [focusItem, setFocusItem] = useState<number | null>(null);
  /** Slide units the panel moves so it stays inside the window. */
  const [nudge, setNudge] = useState({ x: 0, y: 0 });

  // Clamp to the viewport: measured after layout, moved up or left by what spills over.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the frame or the item count moves the panel
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el || typeof window === "undefined") return;
    const box = el.getBoundingClientRect();
    const margin = 8;
    const overY = box.bottom - nudge.y * scale - (window.innerHeight - margin);
    const overX = box.right - nudge.x * scale - (window.innerWidth - margin);
    const y = overY > 0 ? -overY / scale : 0;
    const x = overX > 0 ? -overX / scale : 0;
    if (Math.abs(y - nudge.y) > 0.5 || Math.abs(x - nudge.x) > 0.5) setNudge({ x, y });
  }, [rect.x, rect.y, rect.h, scale, items.length]);

  useEffect(() => {
    if (focusItem === null) return;
    const prefix = `${spec.items}.${focusItem}.`;
    for (const [path, el] of inputs.current)
      if (path.startsWith(prefix)) {
        el.focus();
        break;
      }
    setFocusItem(null);
  }, [focusItem, spec.items]);

  const report = (out: { refused?: string } | undefined): string | undefined => {
    if (out?.refused) toast(out.refused);
    return out?.refused;
  };
  const add = () =>
    report(history.dispatch(reducers.addLayoutItem, slideId, group.id, items.length, kit));
  const remove = (n: number) => {
    const refused = report(history.dispatch(reducers.removeLayoutItem, slideId, group.id, n, kit));
    if (!refused) setFocusItem(Math.min(n, items.length - 2));
  };
  const split = () => report(history.dispatch(reducers.splitLayout, slideId, group.id, kit));
  const shorten = () => {
    const first = over[0];
    if (first) inputs.current.get(first.path)?.focus();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: stops a press in the panel from starting a canvas drag; the controls inside are the interactive ones
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: as above
    <div
      ref={panelRef}
      data-layout-panel-frame
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: rect.x + nudge.x,
        top: rect.y + rect.h + 8 / scale + nudge.y,
        transform: `scale(${1 / scale})`,
        transformOrigin: "0 0",
        pointerEvents: "auto",
        width: 320,
        maxHeight: "calc(100vh - 16px)",
        overflowY: "auto",
      }}
    >
      <section
        aria-label="Layout items"
        data-layout-panel
        className="flex flex-col gap-2 rounded-md border border-border bg-popover p-3 text-sm text-popover-foreground shadow-md"
      >
        {items.map((item, n) => (
          <fieldset
            // biome-ignore lint/suspicious/noArrayIndexKey: an item is its place in the list
            key={n}
            className="flex flex-col gap-1 border-0 p-0"
            aria-label={`Item ${n + 1}`}
          >
            <div className="flex items-center justify-between">
              <legend className="font-medium">Item {n + 1}</legend>
              <Button
                variant="outline"
                size="xs"
                aria-label={`Remove item ${n + 1}`}
                onClick={() => remove(n)}
              >
                Remove
              </Button>
            </div>
            {Object.entries(item as Record<string, unknown>)
              .filter(([, v]) => typeof v === "string")
              .map(([key, value]) => {
                const path = `${spec.items}.${n}.${key}`;
                return (
                  <ItemField
                    key={path}
                    path={path}
                    label={`Item ${n + 1} ${key}`}
                    value={value as string}
                    field={byPath.get(path)}
                    inputRef={(el) => {
                      if (el) inputs.current.set(path, el);
                      else inputs.current.delete(path);
                    }}
                    onCommit={(text) =>
                      report(
                        history.dispatch(
                          reducers.editLayoutItem,
                          slideId,
                          group.id,
                          path,
                          text,
                          kit,
                        ),
                      )
                    }
                  />
                );
              })}
          </fieldset>
        ))}
        <Button variant="outline" size="sm" onClick={add}>
          Add item
        </Button>
        {over.length > 0 ? (
          <div role="alert" className="flex flex-col gap-2 border-t border-border pt-2">
            <p>Too many words to fit this layout. Nothing is cut.</p>
            <div className="flex gap-2">
              {kit.canSplit(ref) ? (
                <Button size="sm" variant="primary" onClick={split}>
                  Split onto a second slide
                </Button>
              ) : null}
              <Button size="sm" variant="outline" onClick={shorten}>
                Shorten
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

/**
 * One item field (ruling 215): the counter follows the typing; the words commit on blur or Enter,
 * Escape drops the draft. A refused commit keeps the draft; a draft started from words that have
 * since changed (undo, redo, another edit) is dropped, so the field always shows the document.
 */
function ItemField({
  path,
  label,
  value,
  field,
  inputRef,
  onCommit,
}: {
  path: string;
  label: string;
  value: string;
  field: kit.LayoutField | undefined;
  inputRef: (el: HTMLTextAreaElement | null) => void;
  onCommit: (text: string) => string | undefined;
}) {
  const [draft, setDraft] = useState<{ base: string; text: string } | null>(null);
  const live = draft && draft.base === value ? draft : null;
  const text = live?.text ?? value;
  const chars = text.trim().length;
  const isOver = field?.state === "over" && live === null;
  const showCount = !!field && (isOver || chars > field.cap);
  const commit = () => {
    if (!live || live.text === value) {
      setDraft(null);
      return;
    }
    if (onCommit(live.text) === undefined) setDraft(null);
  };
  return (
    <label className="flex flex-col gap-0.5" data-field={path}>
      <span className="sr-only">{label}</span>
      <textarea
        ref={inputRef}
        aria-label={label}
        aria-invalid={isOver || undefined}
        data-over={isOver || undefined}
        rows={key(path) === "text" ? 2 : 1}
        className={`w-full resize-none rounded border bg-background px-2 py-1 ${
          isOver ? "border-destructive outline outline-2 outline-destructive" : "border-input"
        }`}
        value={text}
        onChange={(e) => setDraft({ base: value, text: e.target.value })}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setDraft(null);
          }
        }}
      />
      {showCount && field ? (
        <span
          data-counter
          className={`self-end text-xs ${isOver ? "text-destructive" : "text-muted-foreground"}`}
        >
          {chars}/{field.cap}
        </span>
      ) : null}
    </label>
  );
}

const key = (path: string) => path.slice(path.lastIndexOf(".") + 1);
