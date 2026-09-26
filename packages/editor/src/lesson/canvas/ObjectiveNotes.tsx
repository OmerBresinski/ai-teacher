import { type FactId, type Id, objectiveListLines, type Slide } from "@tj/domain/documents";
import { Button, cn } from "@tj/ui";
import { AlertTriangle } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import * as reducers from "../../model/reducers";
import { AddSlidePicker } from "../AddSlidePicker";
import { useHistory, useLesson } from "../document-context";
import { useProposals } from "../proposals-context";
import { useResidualFindings } from "../residual-findings";
import { addSlideAfter, insertSlideAfter } from "../slide-commands";
import { useSelection, useSessionActions, useSessionUi } from "../use-editor-session";
import { type ObjectiveNote, objectiveNotes, oldWordingSentence } from "./objective-notes";

/*
 * The objectives slide's line notes (ruling 96): an amber wavy underline and a note on the line of
 * an objective no slide teaches ("No slide teaches this yet · Add a slide · Ignore"), a red one on
 * a fifth line or an empty box (ruling 64), and — while the box is selected — "Slides 4 and 5 use
 * the old wording · Update them" under a reworded line. Drawn in the canvas's own layer over the
 * slide, like the selection frame, so present mode, export, print and thumbnails never see it.
 * Lines are measured from the rendered list; the notes are counter-scaled to read at one size.
 */

type LineBox = { x: number; y: number; w: number; h: number };
type Measured = Record<string, LineBox[]>;

const keyOf = (elementId: Id, line?: number) => `${elementId}:${line ?? "box"}`;

export function ObjectiveNotes({ slide, scale }: { slide: Slide; scale: number }) {
  /** The layer itself; its parent is the slide frame the lines are measured against. */
  const layer = useRef<HTMLDivElement>(null);
  const lesson = useLesson();
  const history = useHistory();
  const session = useSessionActions();
  const selection = useSelection();
  const { editingTextId } = useSessionUi();
  const { findings } = useResidualFindings();
  const proposals = useProposals();

  // The words each objective had when its box was selected: "the old wording" is measured from
  // here, and the note goes with the selection (ruling 57). Kept per selection, set in render.
  const selectedBox =
    slide.kind === "objectives"
      ? slide.elements.find(
          (e) => e.type === "text" && selection.includes(e.id) && objectiveListLines(e.doc),
        )?.id
      : undefined;
  const [snap, setSnap] = useState<{
    id: Id;
    wording: Map<FactId, string>;
    updated: Set<FactId>;
  } | null>(null);
  if ((selectedBox ?? null) !== (snap?.id ?? null)) {
    setSnap(
      selectedBox
        ? {
            id: selectedBox,
            wording: new Map((lesson.facts?.objectives ?? []).map((o) => [o.id, o.text])),
            updated: new Set(),
          }
        : null,
    );
  }

  const notes = objectiveNotes({
    lesson,
    slide,
    findings,
    selection,
    wordingAtSelect: snap?.wording ?? null,
    updated: snap?.updated ?? EMPTY,
  });
  const updating =
    proposals.busy && snap !== null && snap.updated.size > 0 && selectedBox !== undefined;

  const [measured, setMeasured] = useState<Measured>({});
  const wanted = notes.map((n) => keyOf(n.elementId, "line" in n ? n.line : undefined)).join("|");
  // Reads the rendered list: an external layout read, redone when the slide, the zoom or the set
  // of lines to mark changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `slide` is the trigger — new words re-wrap the lines
  useLayoutEffect(() => {
    // The layer's own ref, not the frame's: a parent's ref is not attached yet when a child's
    // layout effect first runs.
    const stage = layer.current?.parentElement;
    if (!stage || wanted === "") {
      setMeasured((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    const origin = stage.getBoundingClientRect();
    const next: Measured = {};
    for (const key of wanted.split("|")) {
      const [elementId, line] = key.split(":") as [string, string];
      const frame = stage.querySelector<HTMLElement>(
        `[data-slide-clip] [data-element-id="${CSS.escape(elementId)}"]`,
      );
      if (!frame) continue;
      const target = line === "box" ? frame : listItem(frame, Number(line));
      if (!target) continue;
      next[key] = visualLines(target).map((r) => ({
        x: (r.left - origin.left) / scale,
        y: (r.top - origin.top) / scale,
        w: r.width / scale,
        h: r.height / scale,
      }));
    }
    setMeasured((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [wanted, scale, slide]);

  const deps = { history, lesson, session };
  const markUpdated = (factId: FactId) => {
    if (!snap) return;
    setSnap({ ...snap, updated: new Set([...snap.updated, factId]) });
    proposals.onFactsChanged?.([factId]);
  };

  // Stacked notes under one line sit one below the other.
  const stack = new Map<string, number>();
  return (
    <div
      ref={layer}
      data-objective-notes
      aria-live="polite"
      className="pointer-events-none absolute inset-0"
      style={{ zIndex: 30 }}
    >
      {notes.map((note) => {
        const key = keyOf(note.elementId, "line" in note ? note.line : undefined);
        const lines = measured[key];
        if (!lines || lines.length === 0) return null;
        const red = note.kind === "over-cap" || note.kind === "empty";
        const last = lines[lines.length - 1] as LineBox;
        const typing = editingTextId === note.elementId;
        const showNote = red || !typing;
        const order = stack.get(key) ?? 0;
        stack.set(key, order + 1);
        const underline = note.kind !== "old-wording" && note.kind !== "empty";
        return (
          <div key={`${key}:${note.kind}`}>
            {underline
              ? lines.map((l) => (
                  <Wavy
                    key={`${l.x}:${l.y}`}
                    box={l}
                    tone={red ? "error" : "warning"}
                    data-underline={note.kind}
                  />
                ))
              : null}
            {showNote ? (
              <div
                className="absolute"
                style={{
                  left: note.kind === "empty" ? last.x : lines[0]?.x,
                  top:
                    note.kind === "empty"
                      ? last.y + last.h + 4
                      : last.y + last.h + 6 + (order * 30) / scale,
                  transform: `scale(${1 / scale})`,
                  transformOrigin: "top left",
                }}
              >
                <NotePill note={note} deps={deps} onUpdate={markUpdated} />
              </div>
            ) : null}
          </div>
        );
      })}
      {updating && snap ? (
        <UpdatingPill anchor={measured[firstKey(notes, snap.id)]} scale={scale} />
      ) : null}
    </div>
  );
}

const EMPTY: ReadonlySet<FactId> = new Set();

function firstKey(notes: ObjectiveNote[], elementId: Id): string {
  const n = notes.find((x) => x.elementId === elementId && "line" in x);
  return keyOf(elementId, n && "line" in n ? n.line : undefined);
}

function NotePill({
  note,
  deps,
  onUpdate,
}: {
  note: ObjectiveNote;
  deps: Parameters<typeof addSlideAfter>[0];
  onUpdate: (factId: FactId) => void;
}) {
  const { onFactsChanged } = useProposals();
  const lesson = deps.lesson;
  const base =
    "pointer-events-auto inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-chip border bg-card px-2.5 text-meta text-ink-2 shadow-[var(--e-1)]";
  const action = "h-auto p-0 text-meta font-medium";
  switch (note.kind) {
    case "not-taught":
      return (
        <div className={cn(base, "border-warning/40")} data-objective-note="not-taught">
          <AlertTriangle aria-hidden size={14} strokeWidth={1.5} className="text-warning" />
          <span>No slide teaches this yet</span>
          <span aria-hidden>·</span>
          <AddSlidePicker
            themeId={lesson.themeId}
            facts={lesson.facts}
            side="bottom"
            onPick={(kind) => addSlideAfter(deps, note.afterSlideId, kind)}
            onInsert={(slide) => insertSlideAfter(deps, note.afterSlideId, slide)}
            trigger={
              <Button variant="link" size="sm" className={action}>
                Add a slide
              </Button>
            }
          />
          <span aria-hidden>·</span>
          <Button
            variant="link"
            size="sm"
            className={action}
            onClick={() =>
              deps.history.dispatch(reducers.ignoreCheck, "objective-taught", note.factId)
            }
          >
            Ignore
          </Button>
        </div>
      );
    case "old-wording":
      return (
        <div className={base} data-objective-note="old-wording">
          <span>{oldWordingSentence(note.slides)}</span>
          {onFactsChanged ? (
            <>
              <span aria-hidden>·</span>
              <Button
                variant="link"
                size="sm"
                className={action}
                onClick={() => onUpdate(note.factId)}
              >
                {note.slides.length === 1 ? "Update it" : "Update them"}
              </Button>
            </>
          ) : null}
        </div>
      );
    case "over-cap":
      return (
        <div className={cn(base, "border-destructive/40")} data-objective-note="over-cap">
          <AlertTriangle aria-hidden size={14} strokeWidth={1.5} className="text-destructive" />
          <span>Up to four objectives. This line is not saved as one.</span>
        </div>
      );
    case "empty":
      return (
        <div className={cn(base, "border-destructive/40")} data-objective-note="empty">
          <AlertTriangle aria-hidden size={14} strokeWidth={1.5} className="text-destructive" />
          <span>A lesson needs at least one objective.</span>
        </div>
      );
  }
}

function UpdatingPill({ anchor, scale }: { anchor: LineBox[] | undefined; scale: number }) {
  const last = anchor?.[anchor.length - 1];
  if (!last) return null;
  return (
    <div
      className="absolute"
      style={{
        left: anchor?.[0]?.x,
        top: last.y + last.h + 6,
        transform: `scale(${1 / scale})`,
        transformOrigin: "top left",
      }}
    >
      <div
        data-objective-note="updating"
        className="inline-flex h-7 items-center rounded-chip border bg-card px-2.5 text-ink-3 text-meta shadow-[var(--e-1)]"
      >
        Updating slides…
      </div>
    </div>
  );
}

/** A wavy underline under one visual line, in slide units so it scales with the words. */
function Wavy({
  box,
  tone,
  ...rest
}: {
  box: LineBox;
  tone: "warning" | "error";
  "data-underline": string;
}) {
  const period = 8;
  const n = Math.max(1, Math.ceil(box.w / period));
  let d = "M0 3";
  for (let i = 0; i < n; i++) d += ` q${period / 4} -3 ${period / 2} 0 t${period / 2} 0`;
  return (
    <svg
      aria-hidden
      {...rest}
      className={cn(
        "absolute overflow-hidden",
        tone === "error" ? "text-destructive" : "text-warning",
      )}
      style={{ left: box.x, top: box.y + box.h - 1, width: box.w, height: 6 }}
      viewBox={`0 0 ${box.w} 6`}
      preserveAspectRatio="none"
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.75} />
    </svg>
  );
}

/** The `line`-th item of the first list in a rendered text box (static or Tiptap). */
function listItem(frame: HTMLElement, line: number): HTMLElement | null {
  const list = frame.querySelector("ol, ul");
  if (!list) return null;
  const items = Array.from(list.children).filter((c) => c.tagName === "LI");
  return (items[line] as HTMLElement | undefined) ?? null;
}

/** One box per rendered line of `el`'s words (a wrapped line is two), in screen pixels. */
function visualLines(el: HTMLElement): DOMRect[] {
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
  if (rects.length === 0) return [el.getBoundingClientRect()];
  const rows: DOMRect[] = [];
  for (const r of rects) {
    const row = rows.find((x) => Math.abs(x.bottom - r.bottom) < r.height / 2);
    if (!row) {
      rows.push(new DOMRect(r.left, r.top, r.width, r.height));
      continue;
    }
    const left = Math.min(row.left, r.left);
    const right = Math.max(row.right, r.right);
    const top = Math.min(row.top, r.top);
    rows[rows.indexOf(row)] = new DOMRect(
      left,
      top,
      right - left,
      Math.max(row.bottom, r.bottom) - top,
    );
  }
  return rows.sort((a, b) => a.top - b.top);
}
