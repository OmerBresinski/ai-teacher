import {
  type GroupElement,
  type Id,
  type LayoutRef,
  SLIDE_W,
  type SlideElement,
} from "@tj/domain/documents";
import { boundPath } from "@tj/slides/layout-paths";
import * as kit from "@tj/slides/relayout";
import { toast } from "@tj/ui";
import { TriangleAlert, X } from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Point, Rect } from "../../model/geometry";
import { setLayoutKit } from "../../model/layout-kit";
import * as reducers from "../../model/reducers";
import { renderTheme } from "../../model/themes";
import { ICONS } from "../../slide/elements/IconView";
import { useHistory, useLesson } from "../document-context";
import { childRect } from "./layout-children";

// From the icon set the slides already load, so lucide's plus stays in that chunk (bundle budget).
const Plus = ICONS.plus as (typeof ICONS)[string];

// Loading this module is what makes typing on the slide re-flow a layout (`layout-kit.ts`).
setLayoutKit(kit);

/** Screen px round an item where the pointer still counts as on it (reaches its controls). */
const REACH = 30;
const BUTTON = 26;

type Item = { n: number; rect: Rect };

const union = (rs: Rect[]): Rect => {
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  return {
    x,
    y,
    w: Math.max(...rs.map((r) => r.x + r.w)) - x,
    h: Math.max(...rs.map((r) => r.y + r.h)) - y,
  };
};
const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/**
 * Each item's box on the slide: the words bound to it, plus the undrawn-to-a-field pieces that sit
 * with them (an item-row's medal above its name, a list row's icon beside it). Pieces wider than
 * half the layout (a connecting line, a band) belong to no item.
 */
export function itemRects(group: GroupElement & { layout: LayoutRef }): Item[] {
  const spec = kit.ADAPTIVE_SPECS[group.layout.template];
  const re = new RegExp(`^${spec.items}\\.(\\d+)\\.`);
  const bound = new Map<number, Rect[]>();
  for (const c of group.children) {
    const m = re.exec(boundPath(group.id, c.id) ?? "");
    if (!m) continue;
    const n = Number(m[1]);
    bound.set(n, [...(bound.get(n) ?? []), childRect(group, c)]);
  }
  const items = [...bound.entries()]
    .sort(([a], [b]) => a - b)
    .map(([n, rs]) => ({ n, rect: union(rs) }));
  const [a, b] = items;
  const across =
    !a ||
    !b ||
    Math.abs(centre(b.rect).x - centre(a.rect).x) >= Math.abs(centre(b.rect).y - centre(a.rect).y);
  const loose = group.children.filter(
    (c) => !boundPath(group.id, c.id) && c.w < group.w / 2 && c.h < group.h * 0.9,
  );
  return items.map(({ n, rect }) => {
    const mine = loose
      .map((c) => childRect(group, c))
      .filter((r) => {
        const p = centre(r);
        return across
          ? p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y - 220 && p.y <= rect.y + rect.h
          : p.y >= rect.y &&
              p.y <= rect.y + rect.h &&
              p.x >= rect.x - 220 &&
              p.x <= rect.x + rect.w;
      });
    return { n, rect: union([rect, ...mine]) };
  });
}

/**
 * The invisible structure of an adaptive layout, on the slide (TEACH-205 part b, replacing the
 * side panel Greg rejected): with the layout selected, pointing at an item shows a small delete at
 * its corner and an add in the gap after it; both re-flow the layout from its template. Words over
 * what the layout holds get a quiet outline (amber past the comfortable cap, red past the hard
 * maximum), and only past the hard maximum a small chip under the layout offers Shorten and, where
 * the layout continues, Split slide. Lazy: it brings the template code, and registers it so typing
 * re-flows the layout.
 */
export default function LayoutCanvasControls({
  slideId,
  group,
  scale,
  toSlide,
  onEditText,
  onPointerFocus,
}: {
  slideId: Id;
  group: GroupElement & { layout: LayoutRef };
  scale: number;
  toSlide: (clientX: number, clientY: number) => Point;
  onEditText: (id: Id) => void;
  /** Focus the stage as a pointer does, so a press on a control draws no keyboard focus ring. */
  onPointerFocus?: () => void;
}) {
  const lesson = useLesson();
  const history = useHistory();
  const ref = group.layout;
  const spec = kit.ADAPTIVE_SPECS[ref.template];
  const theme = renderTheme(lesson);
  const stage = kit.stageOf(theme, lesson.ageBand);
  const fields = useMemo(() => {
    try {
      return kit.relayout(ref, theme, stage).fields;
    } catch {
      return [];
    }
  }, [ref, theme, stage]);
  const items = useMemo(() => itemRects(group), [group]);
  const count = kit.itemsOf(ref).length;
  const canAdd = count < spec.max(stage);
  const canRemove = count > spec.min;
  const across = (() => {
    const [a, b] = items;
    if (!a || !b) return true;
    return (
      Math.abs(centre(b.rect).x - centre(a.rect).x) >= Math.abs(centre(b.rect).y - centre(a.rect).y)
    );
  })();

  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const p = toSlide(e.clientX, e.clientY);
      const reach = REACH / (scale || 1);
      const hit = items.find(
        ({ rect: r }) =>
          p.x >= r.x - reach &&
          p.x <= r.x + r.w + reach &&
          p.y >= r.y - reach &&
          p.y <= r.y + r.h + reach,
      );
      setHover(hit ? hit.n : null);
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [items, toSlide, scale]);

  const press = (e: ReactPointerEvent) => {
    e.stopPropagation();
    // The press stays a pointer press: the stage keeps focus (its keys keep working) and no ring.
    e.preventDefault();
    onPointerFocus?.();
  };
  const report = (out: { refused?: string } | undefined) => {
    if (out?.refused) toast(out.refused);
  };
  const add = (at: number) =>
    report(history.dispatch(reducers.addLayoutItem, slideId, group.id, at, kit));
  const remove = (n: number) =>
    report(history.dispatch(reducers.removeLayoutItem, slideId, group.id, n, kit));
  const split = () => report(history.dispatch(reducers.splitLayout, slideId, group.id, kit));

  // The selection layer is drawn in slide space (it scales with the slide): boxes are placed in
  // slide points, and chrome that must stay a fixed screen size is divided by the zoom.
  const k = scale || 1;
  const box = (r: Rect): CSSProperties => ({
    position: "absolute",
    left: r.x,
    top: r.y,
    width: r.w,
    height: r.h,
  });
  /** Under the layout, lined up with the long words: from their left, or their right edge when
   *  they sit in the slide's right half, so the chip never runs off the slide. */
  const chipPlace = (r: Rect): CSSProperties => {
    const top = group.y + group.h + 8 / k;
    return r.x + r.w / 2 > SLIDE_W / 2
      ? {
          top,
          right: SLIDE_W - (r.x + r.w),
          transform: `scale(${1 / k})`,
          transformOrigin: "right top",
        }
      : { top, left: r.x, transform: `scale(${1 / k})`, transformOrigin: "left top" };
  };
  const childOf = (path: string): SlideElement | undefined =>
    group.children.find((c) => c.id === `${group.id}:${path}`);
  const marked = fields.flatMap((f) => {
    if (f.state === "ok") return [];
    const c = childOf(f.path);
    return c ? [{ field: f, child: c }] : [];
  });
  const firstOver = marked.find((m) => m.field.state === "over");

  const button = (
    label: string,
    at: Point,
    onClick: () => void,
    shown: boolean,
    icon: "add" | "delete",
  ) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-layout-control={icon}
      data-shown={shown || undefined}
      onPointerDown={press}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`pointer-events-auto absolute flex items-center justify-center rounded-full border border-border bg-surface text-ink-2 shadow-sm transition-opacity hover:bg-accent focus-visible:opacity-100 ${
        shown ? "opacity-100" : "opacity-0"
      }`}
      style={{
        left: at.x,
        top: at.y,
        width: BUTTON,
        height: BUTTON,
        transform: `translate(-50%, -50%) scale(${1 / k})`,
      }}
    >
      {icon === "add" ? (
        <Plus aria-hidden size={16} strokeWidth={2} />
      ) : (
        <X aria-hidden size={14} strokeWidth={2} />
      )}
    </button>
  );

  return (
    <div className="pointer-events-none absolute inset-0" data-layout-controls>
      {marked.map(({ field, child }) => (
        <div
          key={field.path}
          data-layout-mark={field.state}
          title={
            field.state === "over"
              ? "Too long: the end is hidden"
              : "Longer than this layout holds well"
          }
          style={{
            ...box(childRect(group, child)),
            outline: `${1.5 / k}px ${field.state === "over" ? "solid" : "dashed"} var(${
              field.state === "over" ? "--color-destructive" : "--color-warning"
            })`,
            outlineOffset: 2 / k,
            borderRadius: 3 / k,
          }}
        />
      ))}
      {/* The over badge sits outside the box's bottom-right corner, never on its words. */}
      {marked
        .filter(({ field }) => field.state === "over")
        .map(({ field, child }) => {
          const r = childRect(group, child);
          return (
            <span
              key={`badge-${field.path}`}
              data-layout-over-badge
              aria-hidden
              className="absolute flex items-center justify-center rounded-md bg-surface text-destructive shadow-sm"
              style={{
                left: r.x + r.w + 6 / k,
                top: r.y + r.h - 22 / k,
                width: 22,
                height: 22,
                transform: `scale(${1 / k})`,
                transformOrigin: "left top",
                border: "1px solid color-mix(in srgb, var(--color-destructive) 40%, transparent)",
              }}
            >
              <TriangleAlert size={14} strokeWidth={2} />
            </span>
          );
        })}
      {items.map(({ n, rect }, i) => {
        const next = items[i + 1]?.rect;
        const shown = hover === n;
        const gap = across
          ? {
              x: next ? (rect.x + rect.w + next.x) / 2 : rect.x + rect.w + 14 / (scale || 1),
              y: rect.y + rect.h / 2,
            }
          : {
              x: rect.x + rect.w / 2,
              y: next ? (rect.y + rect.h + next.y) / 2 : rect.y + rect.h + 14 / (scale || 1),
            };
        return (
          <div key={n} data-layout-item={n}>
            {/* Which item the controls belong to: a faint outline round it while pointed at. */}
            {shown ? (
              <div
                data-layout-item-outline
                style={{
                  ...box(rect),
                  outline: `${1 / k}px dashed var(--color-border-strong)`,
                  outlineOffset: 6 / k,
                  borderRadius: 6 / k,
                }}
              />
            ) : null}
            {canRemove
              ? button(
                  `Delete item ${n + 1}`,
                  { x: rect.x + rect.w, y: rect.y },
                  () => remove(n),
                  shown,
                  "delete",
                )
              : null}
            {canAdd
              ? button(`Add item after item ${n + 1}`, gap, () => add(n + 1), shown, "add")
              : null}
          </div>
        );
      })}
      {firstOver ? (
        <div
          role="status"
          data-layout-over
          className="pointer-events-auto absolute flex items-center gap-3 whitespace-nowrap rounded-full border border-destructive/40 bg-surface px-3 py-1 text-sm text-destructive shadow-sm"
          style={chipPlace(childRect(group, firstOver.child))}
          onPointerDown={press}
        >
          <span>Too long: the end is hidden</span>
          <button
            type="button"
            className="font-medium underline-offset-2 hover:underline"
            onClick={() => onEditText(firstOver.child.id)}
          >
            Shorten
          </button>
          {kit.canSplit(ref) ? (
            <button
              type="button"
              className="font-medium underline-offset-2 hover:underline"
              onClick={split}
            >
              Split slide
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
