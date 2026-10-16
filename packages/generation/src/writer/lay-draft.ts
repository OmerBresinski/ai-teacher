// Live writing P6 (TEACH-202 part f, ADR 0039): the slide the stream is writing, laid out as it
// stands. A draft is cheap and throwaway: the template's recipe filled with the words so far, every
// picture and diagram an open placeholder. No asks, no diagrams, no checks, no table split, no
// repairs: those run once, when the slide closes (`openSlide`), and the closed slide supersedes
// every draft.
import type { Slide } from "@tj/domain/documents";
import { resolveIcon } from "@tj/slides/icons";
import { PENDING_ICON } from "@tj/slides/templates";
import { fromWriterActivity, isWriterActivity } from "./activities";
import { slideNoEmDash } from "./checks";
import type { SlideDraft } from "./draft";
import { asksVisual, lookOf, shuffleHinge, withLook } from "./fixes";
import {
  isStableGroupSlide,
  type MaterialiseCtx,
  type Materialised,
  materialise,
} from "./materialise";
import { quickCheckDraft, withoutReveals } from "./question-set-draft";
import { nonFatalSync } from "./services";

type S = Record<string, unknown>;
type Laid = Materialised["slide"];
type El = Slide["elements"][number];

/** Each text element's type size on the slide's previous draft, by element id. */
export type DraftSizes = Map<string, number>;

/**
 * A layout mints fresh element ids each time; a live slide's ids are its elements' names in order
 * (`d-s4-Heading-0`, the slide's id first so they stay unique in the deck). One slide's drafts keep
 * their ids from draft to draft, and the laid slide that ends them (`stableIds` in the writer
 * stage) carries the same ones: the renderer updates the same boxes from the first draft to the
 * saved copy rather than mounting new ones, and the type sizes are held per box.
 */
export function stableIds(slide: Laid, slideId: string): Laid {
  const seen = new Map<string, number>();
  const renamed = new Map<string, string>();
  const elements = walk(slide.elements, (e) => {
    const name = (e as { name?: string }).name ?? e.type;
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    const id = `d-${slideId}-${name.replace(/[^\w-]/g, "_")}-${n}`;
    renamed.set(e.id, id);
    return { ...e, id } as El;
  });
  // Anything else on the slide that names an element (the answer data, builds) follows its id.
  const follow = (v: unknown): unknown =>
    v === undefined
      ? v
      : JSON.parse(
          JSON.stringify(v, (_k, x) =>
            typeof x === "string" && renamed.has(x) ? renamed.get(x) : x,
          ),
        );
  return Object.fromEntries(
    Object.entries(slide).map(([k, v]) => [k, k === "elements" ? elements : follow(v)]),
  ) as Laid;
}

/** A draft's ids (`stableIds`); the answer data is left off (nothing on a writing slide reveals answers). */
export function stableDraftIds(slide: Laid, slideId: string): Laid {
  const { question: _q, ...rest } = slide;
  return stableIds(rest as Laid, slideId);
}

const walk = (els: readonly El[], fn: (e: El) => El): El[] =>
  els.map((e) => {
    const next = fn(e);
    const kids = (next as { children?: El[] }).children;
    return Array.isArray(kids) ? ({ ...next, children: walk(kids, fn) } as El) : next;
  });

/**
 * Type only ever steps down while a slide is written (never back up): a size larger than the
 * slide's last draft gave the same element is held at the last one, so words arriving never make
 * the text above them grow and shrink again. `sizes` is updated to the sizes shown.
 */
export function holdTypeSizes(slide: Laid, sizes: DraftSizes): Laid {
  const elements = walk(slide.elements, (e) => {
    const size = (e as { style?: { fontSize?: number } }).style?.fontSize;
    if (e.type !== "text" || typeof size !== "number") return e;
    const was = sizes.get(e.id);
    const shown = was !== undefined && was < size ? was : size;
    sizes.set(e.id, shown);
    return shown === size ? e : ({ ...e, style: { ...e.style, fontSize: shown } } as El);
  });
  return { ...slide, elements };
}

/**
 * A draft laid out: its template and the fields so far through the slide recipe, with every visual
 * an open placeholder (`pending`). Returns undefined when the draft does not lay out yet (a
 * template the recipes do not know, a field half there): the slide then waits for the next draft.
 */
export function layDraft(
  draft: SlideDraft,
  ctx: Omit<MaterialiseCtx, "visual">,
  sizes: DraftSizes,
  stageKey: Parameters<typeof fromWriterActivity>[1],
): Laid | undefined {
  return nonFatalSync(
    () => {
      const { fit: _fit, ...fields } = draft.fields;
      if (draft.template === "hinge" && holdHingeTitle(fields)) return undefined;
      // TEACH-75 part ab (C2): a source waits for its whole `form` ("ver" is not yet verse), so its
      // extract is never laid as prose and then swapped for verse lines under new ids.
      if (draft.template === "source" && draft.open?.[0] === "form") return undefined;
      let s: S = slideNoEmDash({ template: draft.template, ...fields } as S) as S;
      if (isWriterActivity(s.template)) s = fromWriterActivity(s, stageKey, ctx.brief).slide;
      const look = lookOf(ctx.plan.flow?.find((x) => x.slide === ctx.index + 1));
      s = reserveLook(s, look);
      // TEACH-101 part g: a quick check holds every written row's chip; its answers never show.
      s = quickCheckDraft(s);
      s = keepSidePictures(s);
      // A hinge draws its options where the closed slide will: once `correct` has arrived (it
      // follows the options), the same seeded shuffle as the stage, so nothing jumps at hand-over.
      if (s.template === "hinge" && typeof s.correct === "number")
        s = shuffleHinge(s, `${ctx.brief.id}:${ctx.index}:${String(s.stem ?? "")}`);
      s = iconsFromNames(s, draft.open);
      // `draft`: a picture still to come holds its slot while the slide fills.
      const lay = (x: S) =>
        materialise(x, { ...ctx, draft: true, visual: () => ({ status: "pending" }) });
      let m = lay(s);
      // A figure half streamed may not lay out yet: its planned slot holds until it does.
      const field = VISUAL_FIELD[String(s.template)];
      if (field && s[field] != null && !hasVisual(m.slide.elements)) {
        const held = lay(reserveLook({ ...s, [field]: undefined }, look));
        if (hasVisual(held.slide.elements)) m = held;
      }
      // Pilot layouts come out of `materialise` with the closed slide's own ids already.
      // TEACH-17 part b (C1): a worked example's rows are its reveals, not hidden answers; the
      // working writes in as it comes, so its elements are the closed slide's from the first row.
      // TEACH-75 part ab (C2): a source's notes are not answers either; they show as they are
      // written, so nothing vanishes at the hand-over (the closed slide reveals one per click).
      const shown =
        s.template === "worked" || s.template === "source" ? m.slide : withoutReveals(m.slide);
      // A pilot slide laid without its group (a diagram it could not hold) is named like any other.
      const ided = isStableGroupSlide(shown, ctx.index)
        ? (({ question: _q, ...rest }) => rest)(shown)
        : stableDraftIds(shown, `s${ctx.index + 1}`);
      return holdTypeSizes(ided as Laid, sizes);
    },
    () => undefined,
  );
}

/**
 * The hinge's title is its question: the stem when there is one, else the heading (TEACH-256
 * part b). The writer streams `heading` before `stem`, so a draft laid from the heading alone
 * would type the heading in and then swap it for the stem under a new id. No hinge draft is laid
 * until the stem's first word arrives, or the options start with no stem (empty or never written):
 * the heading is then the question.
 */
export function holdHingeTitle(fields: S): boolean {
  if ("options" in fields) return false;
  return String(fields.stem ?? "").trim() === "";
}

/** Layouts with one visual of their own, by the field it streams in. */
const VISUAL_FIELD: Record<string, string> = {
  "visual-text": "figure",
  "big-visual": "figure",
  "equation-hero": "figure",
  steps: "figure",
  "question-set": "figure",
  practice: "figure",
  "exit-ticket": "figure",
  discussion: "picture",
  title: "picture",
};

/**
 * The slide's structure comes first (TEACH-202 part f): the writer streams a slide's figure after
 * its words, but the flow already said whether the slide shows a picture or a diagram. Until the
 * figure's field arrives, a draft holds an open slot where the flow put one, so the visual column
 * is there from the first word and nothing changes shape when the figure (or the closed slide)
 * lands. A field the writer has written, even as null, is its own decision and is left alone; a
 * picture look then goes through `withLook`, exactly as the closed slide will.
 */
export function reserveLook(s: S, look: { kind: string; shows: string | null } | undefined): S {
  if (!look || (look.kind !== "picture" && look.kind !== "diagram") || asksVisual(s)) return s;
  if (look.kind === "picture") {
    const added = withLook(s, look).slide;
    if (added !== s) return added;
  }
  const field = VISUAL_FIELD[String(s.template)];
  // An explicit null is the writer saying "no visual"; a half-streamed figure still holds the slot.
  if (!field || s[field] === null) return s;
  if (s[field] !== undefined && asksVisual(s)) return s;
  const shows = look.shows?.trim() || "planned visual";
  return {
    ...s,
    [field]: { shows, must_see: [shows], subject: "generic", ask: null, ask_without: null },
  };
}

/** The laid slide shows a picture, a diagram or their open slot (anything but words and shapes). */
function hasVisual(els: readonly El[]): boolean {
  return els.some(
    (e) =>
      (e.type !== "text" && e.type !== "shape") ||
      hasVisual(((e as { children?: El[] }).children ?? []) as El[]),
  );
}

/**
 * Split compare's pictures are all or none, and the writer streams each side's picture after its
 * words: laid as it stands, side 1's slot would vanish when side 2 starts (no picture yet) and
 * come back when side 2's arrives. Once any side has a picture, a side whose picture has not
 * arrived yet holds an open slot too, so a slot never vanishes while the slide is written. A
 * side whose writer wrote `picture: null` is its own decision and is left alone.
 */
export function keepSidePictures(s: S): S {
  if (s.template !== "split-compare" || !Array.isArray(s.sides)) return s;
  const sides = s.sides as (S | null | undefined)[];
  // A picture is there once it says what it shows: before that (`{"kind": "labelled-d`) it is
  // still arriving and does not lay out yet.
  const there = (p: unknown) =>
    !!p && typeof p === "object" && typeof (p as S).shows === "string" && !!(p as S).shows;
  const donor = sides.find((d) => there(d?.picture))?.picture;
  if (!donor) return s;
  return {
    ...s,
    sides: sides.map((d) =>
      d && d.picture !== null && !there(d.picture) ? { ...d, picture: donor } : d,
    ),
  };
}

/**
 * Icons while a row streams (stream sim 14 Oct, Greg picked "on name": "without showing numbers if
 * icons are inbound ... can it rather fade in nicely into the space without the placeholder img?").
 * items-row and panel-list draw icons all or none, and the writer writes each item's `icon` after
 * its words, so a draft would show numbers until the last icon lands, then flip. Here:
 * - **Declared so far decides.** Any item with `icon: null` (or a whole label the library misses):
 *   the writer's row as it stands (numbers). Any `icon` opened: icons are inbound. Neither yet:
 *   unknown, and the row is held as icons with every face empty, never a guessed drawing.
 * - **Inbound:** an item draws the writer's own icon once that label is whole and resolves, else
 *   its name's icon once the name is whole and resolves, else an empty face (`PENDING_ICON`). A
 *   face never shows a number or a placeholder drawing; the editor fades each drawing in. Icons
 *   land in reading order (an item waits for an earlier empty one).
 * `open` is where the open string sits (`SlideDraft.open`); a string anywhere else is whole.
 */
export function iconsFromNames(s: S, open?: readonly (string | number)[]): S {
  // TEACH-75 part ac (C4): stages hold their icons the same way, so the strip never flips to the
  // item row's ordered look and back while it streams.
  if (
    (s.template !== "items-row" && s.template !== "panel-list" && s.template !== "stages") ||
    !Array.isArray(s.items)
  )
    return s;
  const items = s.items as unknown[];
  const live = items.filter((it): it is S => !!it && typeof it === "object");
  if (!live.length) return s;
  const whole = (i: number, key: string) =>
    !(open && open[0] === "items" && open[1] === i && open[2] === key);
  const own = (it: S, i: number) =>
    typeof it.icon === "string" && it.icon.trim() && whole(i, "icon") ? it.icon : null;
  // The writer's choice so far: no icons, or a whole label that misses (the row will be numbered).
  if (live.some((it) => it.icon === null)) return s;
  if (
    items.some(
      (it, i) =>
        it && typeof it === "object" && own(it as S, i) && !resolveIcon(own(it as S, i) as string),
    )
  )
    return s;
  const inbound = live.some((it) => typeof it.icon === "string");
  // Icons land in reading order: an item waits while an earlier one is still empty, so a drawing's
  // id (named by its place among the row's drawings) never shifts and nothing lands twice.
  let held = !inbound;
  return {
    ...s,
    items: items.map((it, i) => {
      if (!it || typeof it !== "object") return it;
      const item = it as S;
      const mine = own(item, i);
      const name = typeof item.name === "string" && whole(i, "name") ? item.name : null;
      const label = mine ?? (name && resolveIcon(name) ? name : null);
      if (held || !label) {
        held = true;
        return { ...item, icon: PENDING_ICON };
      }
      return mine ? item : { ...item, icon: label };
    }),
  };
}
