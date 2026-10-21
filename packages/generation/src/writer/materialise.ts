import "../icons-ready";
import type { Slide, Theme } from "@tj/domain/documents";
// TEACH-75 part ad (C5).
import { resolveIcon } from "@tj/slides/icons";
import { PLACEHOLDER_IMAGE } from "@tj/slides/layouts";
import { layoutGroup } from "@tj/slides/relayout";
import {
  type Figure,
  isPointKind,
  layoutTemplate,
  motifOf,
  PLACEHOLDER_ICON,
  REASON_PENDING_ICON,
  type TemplateInput,
  type TemplatePoint,
} from "@tj/slides/templates";
import { answerGroupsOf, endAnswerSlides } from "@tj/slides/templates/end-answers";
// TEACH-239 part b (C7): the figure slide's writer rules (a leaf: no drawing code).
import { FIGURE_WIDE_ASPECT, figureSlideAllowed } from "@tj/slides/templates/figure-rules";
import { activityWords } from "./activities";
import { labelsOf, writerSpecOf } from "./diagrams";
import type { Brief, Stage } from "./fixes";
import { REGISTERED_WRITERS } from "./registered";
import { asks, firstTeaching, slideRole } from "./role";

/*
 * The writer's slides laid out on `@tj/slides` templates (TEACH-110 part a), ported from the
 * pinned writer's layout step. The writer's menu merges two catalogue pairs (`visual-text`,
 * `big-visual`); each written slide is mapped back to its catalogue template here, its figures
 * shown when they have landed and as open slots while pending, and its `ask` / `ask_without`
 * line chosen by whether the figure is shown.
 */

type S = Record<string, unknown>;
type Pic = { shows: string; must_see?: string[]; subject?: "named" | "generic" };
type Dia = { kind: string; shows: string; labels?: string[] };

/** A placed photo as the layout reads it. */
export type PhotoResult = {
  src: string;
  alt: string;
  aspect: number;
  request?: string;
  subjects?: { name: string; x: number; y: number; w: number; h: number }[];
  about?: string;
};
/** A visual a slide asks for, as read off the slide JSON. */
export type VisualAsk =
  | {
      key: string;
      type: "photo";
      shows: string;
      mustSee: string[];
      named: boolean;
      aspect?: number;
      fixedShape?: boolean;
      set?: string;
      /** A cards grid's small square icon (ruling 203): one object, cut out, read at a glance. */
      icon?: boolean;
    }
  | {
      key: string;
      type: "diagram";
      kind: string;
      shows: string;
      labels: string[];
      /** R2 (TEACH-247): the writer's own spec for a structured kind; code draws it. */
      spec?: unknown;
    };
/** What the stage knows about one visual when it lays a slide out. */
export type VisualState =
  | { status: "pending" }
  | { status: "failed" }
  | { status: "photo"; photo: PhotoResult }
  | { status: "diagram"; spec: unknown };

export type Plan = {
  design?: { theme?: string; picture_style?: "photo" | "illustration" };
  objectives?: { teacher: string; pupil: string }[];
  flow?: {
    slide: number;
    does: string;
    look_at?: { kind: string; shows: string | null };
    teaches?: number[];
  }[];
  slides: (S | undefined)[];
};
export type MaterialiseCtx = {
  brief: Brief;
  theme: Theme;
  stage: Stage;
  index: number;
  plan: Plan;
  visual: (key: string) => VisualState;
  /**
   * Greg: a planned visual is never lost. The stage's last resort before a diagram goes unshown: a
   * drawing that draws only with warnings fills its room and its faults come back as `diagramWarnings`.
   */
  diagramWarnings?: boolean;
  /** The slide is still being written (the draft path, TEACH-110 part s): a picture to come holds its slot. */
  draft?: boolean;
};
export type Materialised = {
  slide: Pick<Slide, "kind" | "elements" | "background" | "question">;
  over: string[];
  diagram?: string[];
  /** The faults of a diagram that shipped with warnings because no room drew it cleanly. */
  diagramWarnings?: string[];
  /** Tile visuals (`col.n`, `seq.n`) whose diagram the layout could not show: failed, never empty. */
  lost?: string[];
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
/**
 * A question slide's answers, from its items or its answers list (TEACH-101 part g; practice and
 * exit too, TEACH-110 part v). Each answer's working is its own list by the same index, never
 * joined into the answer, so the end Answers ledger draws it in its own column. A dash the writer
 * put in an answer still becomes ", ": older saved lessons join the two with " — ".
 */
const quickAnswers = (s: S): string[] =>
  Array.isArray(s.items)
    ? s.items.map((i0) =>
        str(((i0 ?? {}) as S).answer)
          .replace(/\s+[—–]\s+/g, ", ")
          .trim(),
      )
    : Array.isArray(s.answers)
      ? s.answers.map((a) => str(a))
      : [];
const quickWorking = (s: S): string[] =>
  Array.isArray(s.items)
    ? s.items.map((i0) =>
        str(((i0 ?? {}) as S).answer).trim() ? str(((i0 ?? {}) as S).working).trim() : "",
      )
    : [];
/** Strings, or each object's `question` (question items) or `text` (hinge options). */
const strs = (v: unknown) =>
  Array.isArray(v)
    ? v.map((x) => (typeof x === "string" ? x : str((x as S)?.question) || str((x as S)?.text)))
    : [];
/**
 * Support points: a string, `{label, text}` (a key card) or `{kind, text}` (a typed callout card,
 * ruling 203). A blank label is no label; an unknown kind is no kind.
 */
const pts = (v: unknown): TemplatePoint[] =>
  Array.isArray(v)
    ? v.map((x) => {
        if (typeof x === "string") return x;
        const o = (x ?? {}) as S;
        const label = str(o.label).trim();
        if (isPointKind(o.kind))
          return { kind: o.kind, text: str(o.text), ...(label ? { label } : {}) };
        return label ? { label, text: str(o.text) } : str(o.text);
      })
    : [];

const isDia = (f: unknown): f is Dia => !!f && typeof f === "object" && "kind" in (f as object);
const isPic = (f: unknown): f is Pic =>
  !!f && typeof f === "object" && "shows" in (f as object) && !("kind" in (f as object));

/** A figure the diagram library draws (`kind: "model"`). */
export const isModel = (f: unknown): boolean =>
  isDia(f) && (f as { kind?: unknown }).kind === "model";
/** TEACH-239 part b (C7): a big visual asking for a library model may become the figure slide. */
const isModelSlide = (s: unknown): boolean => {
  const o = (s ?? {}) as S;
  return (
    o.template === "figure" ||
    (["big-visual", "big-diagram"].includes(str(o.template)) &&
      (isModel(o.figure) || isModel(o.diagram)))
  );
};
/** A drawn library model wider than the figure slide's threshold (narrower ones go beside words). */
const wideModel = (f: Figure | undefined): boolean =>
  !!f && "drawn" in f && !!f.drawn.bare && f.drawn.aspect > FIGURE_WIDE_ASPECT;

/**
 * Points on a full library slide (big-visual, which has none in the schema): a fallback for an
 * output that still carries them, read in the notes rather than dropped. The stage logs it.
 */
export function modelPoints(s: S | undefined): string[] {
  if (!s || s.template !== "big-visual" || !isModel(s.figure)) return [];
  return pts(s.points).map((p) =>
    typeof p === "string" ? p : [p.label, p.text].filter(Boolean).join(": "),
  );
}

/**
 * The menu's merged entries back to catalogue templates: `visual-text` is picture-text or
 * diagram-text and `big-visual` big-picture or big-diagram, by the figure's shape (a `kind` is a
 * diagram); the figure moves to the catalogue slot (`picture` / `diagram`).
 */
export function normalise(s: S): S {
  const t = s.template;
  if (t !== "visual-text" && t !== "big-visual") return s;
  const { figure, ...rest } = s;
  const dia = isDia(figure);
  const template =
    t === "visual-text"
      ? dia
        ? "diagram-text"
        : "picture-text"
      : dia
        ? "big-diagram"
        : "big-picture";
  if (!isDia(figure) && !isPic(figure)) return { ...rest, template: "explain" };
  return { ...rest, template, [dia ? "diagram" : "picture"]: figure };
}

/**
 * Study figures (FIX-PLAN group C, register diagrams-05): kinds pupils read part by part. On a
 * teaching slide they are laid across the slide, the points as key cards under them (ruling 194);
 * the template keeps diagram + text when the drawing would be smaller across the slide.
 */
const STUDY_KINDS = new Set([
  "flow",
  "cycle",
  "timeline",
  "line-graph",
  "labelled-diagram",
  "particles",
]);
export function studyFigure(f: Figure | undefined): boolean {
  if (!f || !("diagram" in f)) return false;
  const d = f.diagram as { kind?: unknown; rows?: unknown };
  const kind = String(d?.kind ?? "");
  return STUDY_KINDS.has(kind) || (kind === "table" && Array.isArray(d.rows) && d.rows.length >= 3);
}
/** A slide that teaches (teach or worked), not one that asks pupils. */
const teaches = (s: S) => !asks(slideRole(s, { index: 0 }));

/**
 * A sequence stage's visual (TEACH-75 part d): the stage itself is a picture (`{shows, must_see,
 * subject, caption}`, every older output) or carries a diagram (`{caption, diagram}`).
 */
const seqFigure = (x: unknown): Pic | Dia | undefined => {
  if (isPic(x)) return x;
  const d = (x as S | null)?.diagram;
  return isDia(d) ? d : undefined;
};
/**
 * A split compare side's visual (TEACH-110 part x): a picture, a diagram-side spec (`{kind…}`),
 * or that diagram wrapped as `{diagram: {kind…}}`, the form a laid side keeps when its drawing
 * was not made. Unwrapped here, so the side's diagram is asked for and drawn, never dropped.
 */
const sideFigure = (x: unknown): Pic | Dia | undefined => (isPic(x) || isDia(x) ? x : seqFigure(x));
/** The keys of a slide's tile diagrams (compare columns, sequence stages). */
export const tileDiagramKeys = (raw: S | undefined): string[] =>
  !raw || typeof raw !== "object"
    ? []
    : figures(normalise(raw))
        .filter(({ key, f }) => /^(col|seq)\./.test(key) && isDia(f))
        .map(({ key }) => key);

/** The pictures and diagrams a slide holds, with stable keys. */
function figures(s: S): { key: string; f: Pic | Dia }[] {
  const out: { key: string; f: Pic | Dia }[] = [];
  for (const k of ["picture", "diagram", "figure"])
    if (isPic(s[k]) || isDia(s[k])) out.push({ key: k, f: s[k] as Pic | Dia });
  (Array.isArray(s.sequence) ? s.sequence : []).forEach((x, n) => {
    const f = seqFigure(x);
    if (f) out.push({ key: `seq.${n}`, f });
  });
  // lostPic (BAKEOFF base4f): a lost compound picture asked again one subject each; the first in
  // the slot, the rest as tiles 1...
  (Array.isArray(s.tiles) ? s.tiles : []).forEach((x, n) => {
    if (isPic(x)) out.push({ key: `tile.${n + 1}`, f: x });
  });
  (Array.isArray(s.columns) ? s.columns : []).forEach((c, n) => {
    const p = (c as S)?.picture;
    if (isPic(p) || isDia(p)) out.push({ key: `col.${n}`, f: p });
  });
  // Cards grid (ruling 203): one small icon picture per card.
  if (s.template === "cards-grid")
    (Array.isArray(s.grid) ? s.grid : []).forEach((c, n) => {
      const p = (c as S)?.icon;
      if (isPic(p)) out.push({ key: `icon.${n}`, f: p });
    });
  // Pilot sets and contrasts (TEACH-110 part s): a panel list's title-panel picture and one per
  // row (row pictures; side by side draws the same rows as cards), and a split compare's sides.
  if (s.template === "panel-list") {
    const pn = (s.panel ?? null) as S | null;
    if (pn && isPic(pn.picture)) out.push({ key: "panel", f: pn.picture });
    (Array.isArray(s.items) ? s.items : []).forEach((i, n) => {
      const p = (i as S)?.picture;
      if (isPic(p)) out.push({ key: `row.${n}`, f: p });
    });
  }
  if (s.template === "split-compare")
    (Array.isArray(s.sides) ? s.sides : []).forEach((d, n) => {
      const f = sideFigure((d as S)?.picture);
      if (f) out.push({ key: `side.${n}`, f });
    });
  // Activity cards (TEACH-101 part b): one single-subject picture slot per card.
  (Array.isArray(s.cards) ? s.cards : []).forEach((c, n) => {
    const p = (c as S)?.picture;
    if (isPic(p)) out.push({ key: `card.${n}`, f: p });
  });
  return out;
}

/**
 * The slide's tiles (picture = tile 0, `tiles` = tiles 1..) as one grid in its panel (BAKEOFF
 * b4-r1t3 layout, used by lostPic). A tile that failed leaves the grid; when the first failed, the
 * next one leads.
 */
function tiled(s: S, main: Figure | undefined, ctx: MaterialiseCtx, mark = false) {
  if (!Array.isArray(s.tiles) || !s.tiles.length) return main;
  const rest = (s.tiles as unknown[])
    .map((t, n) => (isPic(t) ? figureNow(`tile.${n + 1}`, t as Pic, ctx, mark) : undefined))
    .filter((f): f is Figure => !!f && "photo" in f);
  if (main && !("photo" in main)) return main;
  const all = [...(main ? [main, ...((main as { tiles?: Figure[] }).tiles ?? [])] : []), ...rest];
  const [lead, ...more] = all;
  if (!lead || !("photo" in lead)) return main;
  const mode = ["together", "shuffled"].includes(String(s.tile_mode))
    ? (s.tile_mode as "together" | "shuffled")
    : "grid";
  return (more.length ? { ...lead, tiles: more, tileMode: mode } : lead) as Figure;
}

/**
 * A picture sequence or compare keeps its layout when at least half its asked pictures landed
 * (the lost-picture split's rule); the rest show as caption tiles.
 */
export const keepsTiles = (landed: number, asked: number) => asked > 0 && landed * 2 >= asked;

/** The figure a slot shows now: the photo or drawing once landed, an open slot while pending. */
function figureNow(
  key: string,
  f: Pic | Dia,
  ctx: MaterialiseCtx,
  mark = false,
): Figure | undefined {
  const v = ctx.visual(key);
  if (v.status === "photo")
    return {
      photo: v.photo.src,
      alt: v.photo.alt,
      aspect: v.photo.aspect,
      request: v.photo.request,
      ...(v.photo.subjects ? { subjects: v.photo.subjects } : {}),
    } as Figure;
  if (v.status === "diagram") {
    const d = (
      v.spec as {
        drawn?: Extract<Figure, { drawn: unknown }>["drawn"];
      }
    )?.drawn;
    return (d ? { drawn: d } : { diagram: v.spec }) as Figure;
  }
  if (v.status === "failed") return undefined;
  return (
    isDia(f)
      ? { photo: PLACEHOLDER_IMAGE, alt: `Diagram: ${f.shows}` }
      : {
          photo: PLACEHOLDER_IMAGE,
          alt: f.shows,
          request: mark ? `slot:${key}` : [f.shows, ...(f.must_see ?? [])].join(". "),
        }
  ) as Figure;
}

/** Templates whose photo slots crop to their own box. */
const FIXED_SHAPE = new Set([
  "compare",
  "cards-grid",
  "picture-sequence",
  "pair",
  "group-sort",
  "sequence",
  "choose",
  "odd-one-out",
]);
/** Each photo slot's shape on this slide, measured off the slide laid out with every slot open. */
export function slotShapes(
  s: S,
  vctx: Omit<MaterialiseCtx, "visual">,
): Record<string, { aspect: number; fixed: boolean }> {
  const ctx: MaterialiseCtx = { ...vctx, visual: () => ({ status: "pending" }) };
  const input = toInput(s, ctx, true);
  const els = layoutTemplate(input, vctx.theme, vctx.stage).slide.elements;
  const out: Record<string, { aspect: number; fixed: boolean }> = {};
  for (const e of els) {
    const r = (e as { request?: string }).request;
    if (e.type === "image" && r?.startsWith("slot:"))
      out[r.slice(5)] = {
        aspect: Math.round((e.w / e.h) * 100) / 100,
        fixed: FIXED_SHAPE.has(input.template),
      };
  }
  return out;
}

const line = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const joined = (...xs: (string | undefined)[]) => xs.filter(Boolean).join(" ") || undefined;

/**
 * Every picture or diagram request carries `ask`, the one line that needs pupils to see the
 * visual, and `ask_without`, the same move standing alone. The slide shows `ask` when its visual
 * is placed and `ask_without` when it is missing; the line joins the slide's own words.
 */
export function resolveAsks(raw: S, placed: (key: string) => boolean): S {
  const s: S = { ...normalise(raw) };
  const tpl = str(s.template);
  for (const k of ["picture", "diagram", "figure"]) {
    const f = s[k];
    if (!f || typeof f !== "object" || !("ask" in f || "ask_without" in f)) continue;
    const { ask, ask_without, ...rest } = f as S;
    s[k] = rest;
    const l = placed(k) ? line(ask) : line(ask_without);
    if (!l) continue;
    if (["question-set", "practice", "exit-ticket"].includes(tpl))
      s.instruction = joined(l, line(s.instruction));
    else if (tpl === "hinge") s.stem = joined(l, line(s.stem));
    else s.lead = joined(line(s.lead), l);
  }
  if (Array.isArray(s.columns)) {
    // Every card shows its visual or none does (toInput): one missing makes every ask stand alone.
    const cols = s.columns as S[];
    const all = cols.every(
      (c, n) => !(isPic(c?.picture) || isDia(c?.picture)) || placed(`col.${n}`),
    );
    s.columns = cols.map((c) => {
      const p = c?.picture as S | undefined;
      if (!p || typeof p !== "object" || !("ask" in p || "ask_without" in p)) return c;
      const { ask, ask_without, ...rest } = p;
      const l = all ? line(ask) : line(ask_without);
      return { ...c, picture: rest, ...(l ? { text: joined(line(c.text), l) } : {}) };
    });
  }
  if (tpl === "picture-sequence" && ("ask" in s || "ask_without" in s)) {
    const seq = Array.isArray(s.sequence) ? s.sequence : [];
    const all = seq.length > 0 && seq.every((_, n) => placed(`seq.${n}`));
    const l = all ? line(s.ask) : line(s.ask_without);
    delete s.ask;
    delete s.ask_without;
    if (l) s.lead = joined(line(s.lead), l);
  }
  return s;
}

export function toInput(
  raw0: S,
  ctx: MaterialiseCtx,
  mark = false,
  missing?: Set<string>,
): TemplateInput {
  // A visual counts as placed while it is pending (its slot shows) and once it landed.
  const placed = (k: string) => {
    if (missing?.has(k)) return false;
    const st = ctx.visual(k).status;
    return st === "photo" || st === "diagram" || st === "pending";
  };
  const raw = resolveAsks(raw0, placed);
  const s = normalise(raw);
  const template = str(s.template) as TemplateInput["template"];
  const heading = str(s.heading);
  const fig = (k: string) => {
    const f = s[k];
    return isPic(f) || isDia(f) ? figureNow(k, f, ctx, mark) : undefined;
  };
  const lead = s.lead == null ? undefined : str(s.lead);
  // Ruling 195 (layout-03, d52 A y1 s4): a matching task whose card pictures are still missing
  // after their one retry becomes a plain question; it never matches a word to the same word.
  // The writer's own cards are read: a failed picture is already resolved away from `s`.
  const rawCards = Array.isArray((raw0 as S).cards) ? ((raw0 as S).cards as S[]) : [];
  if (
    template === "pair" &&
    rawCards.some((c, n) => c?.picture != null && ctx.visual(`card.${n}`).status === "failed")
  ) {
    const language = isLanguageLesson(ctx.brief?.subject);
    const questions = ((s.cards as S[]) ?? [])
      .map((c) => whatIs(str(c?.text ?? c?.label ?? ""), language))
      .filter((q): q is string => !!q);
    // fewer than two questions is no question set: the pair stays as it was
    if (questions.length >= 2) return { template: "question-set", heading, questions };
  }
  switch (template) {
    case "title":
      return { template, heading, lead, figure: fig("picture") };
    case "objectives":
      return {
        template,
        heading: heading || "Today we are learning to",
        points: (ctx.plan.objectives ?? []).map((o) => o.pupil),
      };
    case "explain":
      return { template, heading, lead, points: pts(s.points) };
    case "picture-text":
    case "diagram-text": {
      const f = fig(template === "picture-text" ? "picture" : "diagram");
      const points = pts(s.points);
      if (template === "diagram-text" && points.length && studyFigure(f) && teaches(raw))
        return { template: "big-diagram", heading, lead, points, figure: f };
      // Wave C (TEACH-110 part v): picture-text's key cards and the icon shown if the picture fails.
      const cards = Array.isArray(s.cards) ? (s.cards as S[]) : [];
      const ptIcon = typeof s.icon === "string" && s.icon.trim() ? s.icon : null;
      const pictureText =
        template === "picture-text" && (cards.length || ptIcon)
          ? {
              ...(ptIcon ? { icon: ptIcon } : {}),
              ...(cards.length
                ? {
                    cards: cards.map((c) =>
                      Object.fromEntries(Object.entries(c).filter(([, v]) => v !== null)),
                    ),
                  }
                : {}),
            }
          : null;
      // A picture or diagram that could not be made: the words stand alone, never an empty panel.
      return {
        template: f ? template : "explain",
        heading,
        lead,
        points: pts(s.points),
        figure: f,
        ...(f && pictureText ? { pictureText } : {}),
      } as TemplateInput;
    }
    case "big-picture":
    case "big-diagram": {
      const f = fig(template === "big-picture" ? "picture" : "diagram");
      // A library model's slide: heading, the model, and the one-line lead as its takeaway under it
      // (a model drawn as the slide body keeps it too: the drawing fits above it).
      // A long table's slide moved across the slide (table-pack.ts, `cardsUnder`) carries its
      // points as key cards (ruling 194); other big visuals' points are read in the notes.
      const cards = template === "big-diagram" && s.cardsUnder === true ? pts(s.points) : [];
      // TEACH-239 part b (C7): a wide library model is the lesson's figure slide (ruling 229).
      if (
        !cards.length &&
        wideModel(f) &&
        figureSlideAllowed(ctx.plan.slides, ctx.index, isModelSlide)
      )
        return { template: "figure", heading, ...(lead ? { lead } : {}), figure: f };
      return f
        ? { template, heading, lead, figure: f, ...(cards.length ? { points: cards } : {}) }
        : { template: "explain", heading, lead: lead ?? "" };
    }
    case "picture-sequence": {
      const seq = (Array.isArray(s.sequence) ? s.sequence : []) as (Pic & { caption?: string })[];
      const lost = (n: number) =>
        ctx.visual(`seq.${n}`).status === "failed" || !!missing?.has(`seq.${n}`);
      const asked = seq.filter((x) => seqFigure(x)).length;
      const gone = seq.filter((x, n) => seqFigure(x) && lost(n)).length;
      // A lost diagram panel, or under half the pictures landed: the stages become numbered steps,
      // never an empty panel.
      const diaGone = seq.some((x, n) => isDia(seqFigure(x)) && lost(n));
      if (gone && (diaGone || !keepsTiles(asked - gone, asked)))
        return lead
          ? { template: "explain", heading, lead, points: seq.map((x) => str(x.caption)) }
          : { template: "steps", heading, points: seq.map((x) => str(x.caption)) };
      // At least half landed (LAYOUT-SEL Egypt s6): the sequence stays, and a panel whose picture
      // could not be made is a tile with its own caption and no picture.
      return {
        template,
        heading,
        ...(lead ? { lead } : {}),
        sequence: seq.map((x, n) => {
          const f = seqFigure(x);
          if (f && lost(n)) return { caption: str(x.caption), tile: true };
          return {
            caption: str(x.caption),
            figure: f ? figureNow(`seq.${n}`, f, ctx, mark) : undefined,
          };
        }),
      };
    }
    case "compare": {
      const cols = (Array.isArray(s.columns) ? s.columns : []) as S[];
      // A diagram tile (TEACH-75 part d) counts like a picture: drawn, pending, or failed.
      const vis = (c: S) => isPic(c.picture) || isDia(c.picture);
      const lost = (n: number) =>
        ctx.visual(`col.${n}`).status === "failed" || !!missing?.has(`col.${n}`);
      const asked = cols.filter(vis).length;
      const gone = cols.filter((c, n) => vis(c) && lost(n)).length;
      // Under half the column pictures landed: every column goes without (text cards). At least
      // half: a column whose picture failed shows its label on a tile in the picture band.
      // A lost diagram tile (TEACH-75 part d) still takes every card's visual away.
      const diaGone = cols.some((c, n) => isDia(c.picture) && lost(n));
      const without = gone > 0 && (diaGone || !keepsTiles(asked - gone, asked));
      return {
        template,
        heading,
        ...(lead && !cols.some(vis) ? { lead } : {}),
        columns: cols.map((c, n) => {
          const p = c.picture;
          const pic = (isPic(p) || isDia(p)) && !without;
          const tile = pic && lost(n);
          const f = pic && !tile ? figureNow(`col.${n}`, p, ctx, mark) : undefined;
          return {
            label: str(c.label),
            text: str(c.text),
            ...(f ? { figure: f } : {}),
            ...(tile ? { tile: true } : {}),
          };
        }),
      };
    }
    case "steps": {
      // Steps with an ask line read as a lead and points beside the figure.
      const f = fig("figure");
      // Wave C (TEACH-110 part v): one step beside a library model (`steps~step-model`).
      const st = (s.step && typeof s.step === "object" ? s.step : null) as S | null;
      if (st && f)
        return {
          template,
          heading,
          step: {
            ...(typeof st.n === "number" ? { n: st.n } : {}),
            do: str(st.do),
            ...(typeof st.see === "string" && st.see.trim() ? { see: st.see } : {}),
          },
          figure: f,
        } as TemplateInput;
      const points = strs(s.points ?? s.steps);
      if (!lead) return { template, heading, points, figure: f };
      if (!f) return { template: "explain", heading, lead, points };
      return {
        template: "photo" in f ? "picture-text" : "diagram-text",
        heading,
        lead,
        points,
        figure: f,
      };
    }
    case "equation-hero":
      return {
        template,
        heading,
        ...(lead ? { lead } : {}),
        formula: str(s.formula),
        points: strs(s.points ?? s.lines),
        figure: fig("figure"),
      };
    case "source": {
      // TEACH-75 part ab (C2): a verbatim extract with 2-4 notes pinned to their lines; a picture
      // source shows its picture slot, or the "from" words alone when it could not be made.
      const form = s.form === "verse" || s.form === "picture" ? s.form : "prose";
      const f = form === "picture" ? fig("picture") : undefined;
      return {
        template,
        heading,
        form,
        from: str(s.from),
        extract: typeof s.extract === "string" ? s.extract : "",
        notes: (Array.isArray(s.notes) ? s.notes : []).map((n0) => {
          const n = (n0 && typeof n0 === "object" ? n0 : { text: n0 }) as S;
          return {
            ...(typeof n.anchor === "string" ? { anchor: n.anchor } : {}),
            label: str(n.label),
            text: str(n.text),
          };
        }),
        ...(f ? { figure: f } : {}),
      } as TemplateInput;
    }
    case "hinge":
      return {
        template,
        heading,
        stem: str(s.stem),
        options: (Array.isArray(s.options) ? s.options : []).map((o) =>
          o && typeof o === "object" ? str((o as S).text) : str(o),
        ),
        // TEACH-256 part b: an option may carry an icon label (all icons: picture tiles) and, when
        // wrong, the belief behind it (speaker notes only, ruling 241).
        ...(Array.isArray(s.options) && s.options.some((o) => o && typeof o === "object")
          ? {
              choices: s.options.map((o0) => {
                const o = (o0 && typeof o0 === "object" ? o0 : { text: o0 }) as S;
                return {
                  text: str(o.text),
                  ...(o.icon ? { icon: str(o.icon) } : {}),
                  ...(o.why ? { why: str(o.why) } : {}),
                };
              }),
            }
          : {}),
        ...(s.correct !== undefined ? { correct: Number(s.correct) } : {}),
        ...(s.explanation ? { explanation: str(s.explanation) } : {}),
        // TEACH-75 part d: the figure the question is about, beside the options.
        ...(fig("figure") ? { figure: fig("figure") } : {}),
      };
    case "pair":
    case "group-sort":
    case "sequence":
    case "choose":
    case "odd-one-out":
    case "label": {
      // A card's picture is pending (an open slot), placed, or failed: a failed card is word-only.
      const cards = (Array.isArray(s.cards) ? s.cards : []).map((c0, n) => {
        const c = (c0 ?? {}) as S;
        const f = isPic(c.picture) ? figureNow(`card.${n}`, c.picture, ctx, mark) : undefined;
        return {
          text: str(c.text),
          ...(f ? { figure: f } : {}),
          ...(c.group !== undefined ? { group: Number(c.group) } : {}),
        };
      });
      const targets = (Array.isArray(s.targets) ? s.targets : []).map((t0) => {
        const t = (t0 ?? {}) as S;
        return { x: Number(t.x), y: Number(t.y), text: str(t.text) };
      });
      const f = fig("diagram") ?? fig("figure");
      return {
        template,
        heading,
        ...(lead ? { lead } : {}),
        cards,
        ...(Array.isArray(s.groups) ? { groups: strs(s.groups) } : {}),
        ...(s.correct !== undefined ? { correct: Number(s.correct) } : {}),
        ...(s.explanation ? { explanation: str(s.explanation) } : {}),
        ...(targets.length ? { targets } : {}),
        ...(Array.isArray(s.extra) ? { extra: strs(s.extra) } : {}),
        ...(f ? { figure: f } : {}),
      };
    }
    case "question-set":
    case "practice":
    case "exit-ticket":
      return {
        template,
        heading,
        // TEACH-101 part g: a quick check comes as `items: [{ question, answer }]` (or as
        // `questions` with `answers`); a set that carries its answers draws as the quick check.
        questions: strs(Array.isArray(s.items) ? s.items : s.questions),
        ...(quickAnswers(s).some(Boolean) ? { answers: quickAnswers(s) } : {}),
        ...(quickWorking(s).some(Boolean) ? { working: quickWorking(s) } : {}),
        ...(s.instruction ? { instruction: str(s.instruction) } : {}),
        figure: tiled(s, fig("picture") ?? fig("figure"), ctx, mark),
      };
    case "cards-grid":
      // Ruling 203: an icon still being found is an open slot; one that failed (after its one
      // retry) shows the theme's glyph, never an empty box.
      return {
        template,
        heading,
        ...(lead ? { lead } : {}),
        grid: (Array.isArray(s.grid) ? s.grid : []).map((c0, n) => {
          const c = (c0 ?? {}) as S;
          const planned = isPic(c.icon);
          const f = planned ? figureNow(`icon.${n}`, c.icon as Pic, ctx, mark) : undefined;
          return {
            label: str(c.label),
            text: str(c.text),
            ...(f ? { icon: f } : planned ? { iconLost: true } : {}),
          };
        }),
      };
    case "items-row":
      // TEACH-75 part u: icons are labels the slides' icon library matches; a miss numbers the
      // row and comes back in `iconMisses`, so there is no picture ask and no lost picture.
      return {
        template,
        heading,
        ...(lead ? { lead } : {}),
        ...(s.accentWord ? { accentWord: str(s.accentWord) } : {}),
        ordered: s.ordered === true,
        // A line style when the writer names one (menu v4); unknown is plain.
        ...(typeof s.motif === "string" ? { motif: motifOf(s.motif) } : {}),
        items: (Array.isArray(s.items) ? s.items : []).map((i0) => {
          const i = (i0 ?? {}) as S;
          return {
            name: str(i.name),
            text: str(i.text),
            // The placeholder is the editor's for a teacher's blank, never the writer's: dropped,
            // so a row that leans on it is numbered.
            ...(typeof i.icon === "string" && i.icon.trim() && i.icon.trim() !== PLACEHOLDER_ICON
              ? { icon: i.icon }
              : {}),
          };
        }),
      };
    // TEACH-75 part ac (C4): stages. A picture still to come holds its tile in a draft; a picture
    // that failed leaves the stage its icon; a stage with neither lays the item row's ordered look.
    case "stages":
      return {
        template,
        heading,
        ...(s.accentWord ? { accentWord: str(s.accentWord) } : {}),
        ...(typeof s.motif === "string" ? { motif: motifOf(s.motif) } : {}),
        stages: (Array.isArray(s.items) ? s.items : []).map((i0, n) => {
          const i = (i0 ?? {}) as S;
          const p = isPic(i.picture)
            ? figureNow(`stage.${n}`, i.picture as Pic, ctx, mark)
            : undefined;
          const held =
            ctx.draft && isPic(i.picture) && !p ? { photo: PLACEHOLDER_IMAGE, alt: "" } : null;
          const picture = p ?? held;
          return {
            name: str(i.name),
            line: str(i.line ?? i.text),
            ...(typeof i.icon === "string" && i.icon.trim() && i.icon.trim() !== PLACEHOLDER_ICON
              ? { icon: i.icon }
              : {}),
            ...(picture ? { picture: picture as Figure } : {}),
          };
        }),
      } as TemplateInput;
    // TEACH-75 part ag (G1): myth and fact. The writer's `myth` fields as they are; a proof picture
    // still to come holds its slot in a draft, one that failed leaves the line alone (myth-c).
    case "myth": {
      const m = (s.myth && typeof s.myth === "object" ? s.myth : s) as S;
      const p0 = (m.proof && typeof m.proof === "object" ? m.proof : null) as S | null;
      const pic =
        p0 && isPic(p0.picture) ? figureNow("proof", p0.picture as Pic, ctx, mark) : undefined;
      const held =
        ctx.draft && p0 && isPic(p0.picture) && !pic ? { photo: PLACEHOLDER_IMAGE, alt: "" } : null;
      const icons = Array.isArray(p0?.icons)
        ? (p0.icons as unknown[]).filter((i) => typeof i === "string")
        : [];
      return {
        template,
        heading,
        myth: {
          ...(m.opening === "straight" ? { opening: "straight" } : {}),
          ...(m.verdict === "true" ? { verdict: "true" } : {}),
          claim: str(m.claim),
          fact: str(m.fact),
          ...(typeof m.factEm === "string" && m.factEm.trim() ? { factEm: m.factEm } : {}),
          ...(p0 && str(p0.line).trim()
            ? {
                proof: {
                  line: str(p0.line),
                  ...(icons.length ? { icons: icons as string[] } : {}),
                  ...(pic || held ? { picture: (pic ?? held) as Figure } : {}),
                },
              }
            : {}),
        },
      } as TemplateInput;
    }
    // The pilot sets and contrasts (TEACH-110 part s).
    // Row and side pictures go through figureNow, so a pending one is the open slot.
    case "panel-list": {
      const items = (Array.isArray(s.items) ? s.items : []) as (S | null)[];
      const pictured = items.some((i) => isPic(i?.picture));
      const rows = items.map((i0, n) => {
        const i = (i0 ?? {}) as S;
        const p = isPic(i.picture) ? figureNow(`row.${n}`, i.picture as Pic, ctx, mark) : undefined;
        // A draft holds the slot of a picture still to come (DRAFT-MODE.md); closed, all or none.
        const held =
          ctx.draft && i.picture !== null && !p ? { photo: PLACEHOLDER_IMAGE, alt: "" } : null;
        return {
          name: str(i.name),
          text: str(i.text),
          icon: !pictured && typeof i.icon === "string" && i.icon.trim() ? i.icon : null,
          ...(pictured ? { picture: (p ?? held) as Figure | null } : {}),
        };
      });
      const pn = (s.panel ?? null) as S | null;
      const panelPic =
        pn && isPic(pn.picture) ? figureNow("panel", pn.picture as Pic, ctx, mark) : undefined;
      return {
        template,
        heading,
        ...(lead ? { lead } : {}),
        ...(s.accentWord ? { accentWord: str(s.accentWord) } : {}),
        rows,
        // The title panel's own picture (menu v4.3 `panel: {picture}`); shares and none are none.
        panel: panelPic ? { picture: panelPic } : null,
      } as TemplateInput;
    }
    case "split-compare":
      return {
        template,
        heading,
        ...(s.accentWord ? { accentWord: str(s.accentWord) } : {}),
        ...(typeof s.marker === "string" ? { marker: s.marker } : {}),
        sides: (Array.isArray(s.sides) ? s.sides : []).map((d0, n) => {
          const d = (d0 ?? {}) as S;
          const f = sideFigure(d.picture);
          const p = f ? figureNow(`side.${n}`, f, ctx, mark) : undefined;
          return {
            title: str(d.title),
            text: str(d.text),
            ...(typeof d.quote === "string" && d.quote ? { quote: d.quote } : {}),
            ...(p ? { picture: p } : {}),
          };
        }),
      } as TemplateInput;
    // TEACH-17 part b (C1): the worked example. The writer's `panel` is the layout's `barPanel`;
    // its guard (and a build count off the rows) falls back to the text-only base in the layout.
    case "worked": {
      const ls = (Array.isArray(s.lines) ? s.lines : []) as (S | null)[];
      return {
        template,
        heading,
        lines: ls.map((l0) => {
          const l = (l0 ?? {}) as S;
          return {
            ...(typeof l.move === "string" && l.move.trim() ? { move: l.move } : {}),
            eq: str(l.eq),
            ...(l.answer === true ? { answer: true } : {}),
          };
        }),
        ...(typeof s.check === "string" && s.check.trim() ? { check: s.check } : {}),
        ...(Array.isArray(s.vars) ? { vars: s.vars.filter((v) => typeof v === "string") } : {}),
        ...(s.panel && typeof s.panel === "object" ? { barPanel: s.panel } : {}),
      } as TemplateInput;
    }
    // TEACH-239 part b (C7): the figure slide. One model or photo, its caption (`caption` or
    // `lead`), and the topic's icon for the plate when the figure could not be made. A second one
    // in a lesson, or one beside another diagram slide, is laid as the old big visual (ruling 229).
    case "figure": {
      const f = fig("figure") ?? fig("diagram") ?? fig("picture");
      const caption = str(s.caption ?? s.lead).trim();
      const icon = str(s.icon).trim();
      const accent = s.accentWord ? { accentWord: str(s.accentWord) } : {};
      // The same candidates as the big-visual route, so a wide model there counts as this lesson's one.
      if (!figureSlideAllowed(ctx.plan.slides, ctx.index, isModelSlide))
        return f
          ? {
              template: "photo" in f ? "big-picture" : "big-diagram",
              heading,
              lead: caption,
              figure: f,
            }
          : { template: "explain", heading, lead: caption };
      if (!f && !icon) return { template: "explain", heading, lead: caption };
      return {
        template,
        heading,
        ...accent,
        ...(caption ? { lead: caption } : {}),
        ...(f ? { figure: f } : { icon }),
      };
    }
    // TEACH-75 part ad (C5): reasons. Icons are library labels (no picture ask). A draft whose
    // reasons have icons coming holds the empty face on a reason whose icon has not arrived or is
    // still a partial label, so the icons never drop out (all or none) while the row streams; the
    // closed slide reads the writer's labels as they are.
    case "reasons": {
      const items = (Array.isArray(s.items) ? s.items : []) as (S | null)[];
      const iconOf = (i: S) => (typeof i.icon === "string" && i.icon.trim() ? i.icon : null);
      const inbound = ctx.draft && items.some((i) => i && iconOf(i));
      return {
        template,
        heading,
        ...(lead ? { lead } : {}),
        chain: s.kind === "chain" || s.chain === true,
        reasons: items.map((i0) => {
          const i = (i0 ?? {}) as S;
          const own = iconOf(i);
          const icon = inbound
            ? own && resolveIcon(own)
              ? own
              : i.icon === null
                ? null
                : REASON_PENDING_ICON
            : own;
          return { head: str(i.head), line: str(i.line), ...(icon ? { icon } : {}) };
        }),
      } as TemplateInput;
    }
    case "banner-text": {
      // Ruling 203 (P4): the photo as a strip over or under the words. A picture that could not
      // be made (after the same retries and lostPic ladder as any picture slot) leaves the words
      // alone, never an empty strip; the layout puts a photo it cannot crop cleanly beside them.
      const f = fig("picture");
      return f
        ? {
            template,
            heading,
            lead,
            points: pts(s.points),
            figure: f,
            at: s.at === "bottom" ? "bottom" : "top",
          }
        : { template: "explain", heading, lead, points: pts(s.points) };
    }
    case "hook": {
      // Ruling 203 (P5): the photo full bleed under the scrim. A picture that could not be made
      // (after the same retries and lostPic ladder as any picture slot) makes the slide a
      // discussion prompt, never an empty dark slide.
      const f = fig("picture");
      return f
        ? { template, heading, lead: lead ?? "", figure: f }
        : { template: "discussion", heading, lead: lead ?? "" };
    }
    case "discussion":
      return {
        template,
        heading,
        lead: lead ?? str(s.question),
        figure: tiled(s, fig("picture") ?? fig("figure"), ctx, mark),
      };
    default: {
      // TEACH-106 part b: a layout registered in `registered.ts`.
      const own = REGISTERED_WRITERS[template];
      if (own) return own.toInput({ s, ctx, mark, heading, lead });
      return {
        template: "explain",
        heading: heading || `Unknown template ${template}`,
        lead: lead ?? "",
      };
    }
  }
}

/**
 * A diagram figure's ask (`arm-t.ts` r2Ask): a structured figure is the writer's own spec and its
 * words stand in for labels; a freeform figure keeps `{kind, shows, labels}` for the drawer.
 */
function diagramVisualAsk(key: string, f: S): VisualAsk {
  // A library model (TEACH-247 part h): the writer's intent is what it shows; code fills it.
  if (f.kind === "model")
    return {
      key,
      type: "diagram",
      kind: "model",
      shows: String(f.intent ?? ""),
      labels: [],
      spec: { model: f.model, intent: f.intent, alt: f.alt },
    };
  const spec = writerSpecOf(f);
  const base = {
    key,
    type: "diagram" as const,
    kind: String(f.kind),
    shows: String(f.shows ?? ""),
  };
  if (spec) return { ...base, labels: labelsOf(spec), spec };
  return { ...base, labels: Array.isArray(f.labels) ? (f.labels as string[]) : [] };
}

/**
 * What a writer picture shows, for its search: its own `shows`, else its `must_see`, alt or
 * caption, else the slide's heading or first point. Empty only when the slide has no words at
 * all (the director then logs a miss).
 */
export function pictureShows(f: Pic | Dia, slide: S): string {
  const p = f as Record<string, unknown>;
  const mustSee = Array.isArray(p.must_see) ? (p.must_see as unknown[]).map(str) : [];
  const point = pts(slide.points)
    .map((x) => (typeof x === "string" ? x : [x.label, x.text].filter(Boolean).join(": ")))
    .find((x) => x.trim());
  for (const v of [
    p.shows,
    mustSee.filter((m) => m.trim()).join(", "),
    p.alt,
    p.caption,
    slide.heading,
    point,
  ]) {
    const t = str(v).trim();
    if (t) return t;
  }
  return "";
}

/** The visuals one finished slide asks for (keys unique within the slide). */
export function visualsOf(
  raw: S,
  index: number,
  vctx: Omit<MaterialiseCtx, "index" | "visual">,
): VisualAsk[] {
  const s = normalise(raw);
  const slots = slotShapes(s, { ...vctx, index });
  const figs = figures(s);
  const shows = (pre: string) =>
    figs.filter(({ key, f }) => key.startsWith(pre) && !isDia(f)).map(({ f }) => f.shows);
  // A sequence's panels are made together as one set; a compare card gets its own picture.
  // Activity cards are made as one set too: the director makes a generic set in one style and
  // sends a named or historical set down its ladder card by card (ruling 163).
  const setOf = (key: string) =>
    key.startsWith("seq.") && shows("seq.").length >= 2
      ? "seq"
      : key.startsWith("card.") && shows("card.").length >= 2
        ? "cards"
        : undefined;
  return figs.map(
    ({ key, f }): VisualAsk =>
      isDia(f)
        ? diagramVisualAsk(key, f as unknown as S)
        : {
            key,
            type: "photo",
            // A planned picture is never lost to a missing `shows` (an old swap, a terse reply).
            shows: pictureShows(f, s),
            mustSee: f.must_see ?? [],
            named: f.subject === "named",
            ...(slots[key] ? { aspect: slots[key].aspect, fixedShape: slots[key].fixed } : {}),
            ...(setOf(key) ? { set: setOf(key) } : {}),
            ...(key.startsWith("icon.") ? { icon: true } : {}),
          },
  );
}

/**
 * Every element the writer path lays down is the AI's (`authoredBy: "ai"`), so the editor reads a
 * writer slide as generated (`isGeneratedSlide`): no "Why?" lane owed on a hinge with no
 * explanation (the false "clashing" fault), and the generated-slide protections apply.
 */
export function aiAuthored<T extends { slide: { elements: unknown[] } }>(m: T): T {
  const elements = m.slide.elements.map((e) =>
    e && typeof e === "object" && !(e as { authoredBy?: unknown }).authoredBy
      ? { ...e, authoredBy: "ai" }
      : e,
  );
  return { ...m, slide: { ...m.slide, elements } };
}

/** A language lesson, whose card words are in the target language ("chat" is French for cat). */
export const isLanguageLesson = (subject: string | undefined) =>
  /\b(french|spanish|german|italian|latin|mandarin|chinese|japanese|welsh|arabic|urdu|polish|portuguese|languages?|mfl)\b/i.test(
    subject ?? "",
  );

/**
 * A plain recall question about one card's word: "What is a kitten?"; in a language lesson, or for
 * anything but one plain word, "What does “chat” mean?". Undefined for a card with no words.
 */
export function whatIs(word: string, language = false): string | undefined {
  const w = word.trim().replace(/[.?!]+$/, "");
  if (!w) return undefined;
  if (!language && /^[a-z]+$/.test(w)) return `What is ${/^[aeiou]/.test(w) ? "an" : "a"} ${w}?`;
  return `What does “${w}” mean?`;
}

/** Pilot layouts kept as re-layable groups (prototype, see `materialise`). */
const ADAPTIVE = new Set(["items-row", "panel-list", "split-compare"]);
// TEACH-75 part ac (C4).
ADAPTIVE.add("stages");
// TEACH-75 part ad (C5).
ADAPTIVE.add("reasons");
// TEACH-106 part b: the adaptive layouts registered in `registered.ts`.
for (const [id, d] of Object.entries(REGISTERED_WRITERS)) if (d.adaptive) ADAPTIVE.add(id);

/**
 * Layouts whose drafts and closed slide share ids (draft mode, TEACH-110 s): the pilot layouts,
 * wrapped in one `layoutGroup` whose id comes from the slide's place and whose children are
 * `<group>:<path>`, so the hand-over from the last draft remounts nothing.
 */
export const STABLE_ID_TEMPLATES: ReadonlySet<string> = ADAPTIVE;
/**
 * The id prefix of the slide at `index` (0-based): `d-s<n>-` with n its place in the deck, the
 * slide's own id (`s<n>`), as every other draft's ids are (`stableDraftIds`). One scheme for the
 * whole lesson: a pilot slide's group was once numbered from 0 (`d-s3-layout` on s4), so the
 * next slide's draft carried the open slide's prefix (TEACH-110 part w).
 */
export const stableIdPrefix = (index: number) => `d-s${index + 1}-`;

/**
 * The slide is one pilot layout group with the ids its place gives it (`materialise`): its
 * children are `<group>:<path>`, the ids the editor binds add, delete and split to, and the ids
 * every draft of the slide already showed. Renaming them (`stableIds`) unbinds the group.
 */
export function isStableGroupSlide(
  slide: { elements: readonly unknown[] },
  index: number,
): boolean {
  const [only, ...rest] = slide.elements as { id?: string; type?: string; layout?: unknown }[];
  return (
    rest.length === 0 &&
    only?.type === "group" &&
    !!only.layout &&
    only.id === `${stableIdPrefix(index)}layout`
  );
}

/** A pilot layout's fit at its drawn size: the laid template and its per-field report. */
export function pilotFit(s: S, ctx: MaterialiseCtx) {
  const input = toInput(s, ctx);
  const r = layoutTemplate(input, ctx.theme, ctx.stage);
  return { template: String(input.template), fields: r.fields ?? [], over: r.over };
}

/** Lay one slide out from its JSON and the visuals' current states. */
export function materialise(s: S, ctx: MaterialiseCtx): Materialised {
  let r = layoutTemplate(toInput(s, ctx), ctx.theme, ctx.stage);
  // Greg: a planned visual is never lost. When no room drew the diagram cleanly and the stage has
  // nothing better (`ctx.diagramWarnings`), the least-bad drawing ships with its warnings (logged on
  // visual-path) rather than leaving the slide without it.
  if (r.diagram?.length && ctx.diagramWarnings) {
    const warned = layoutTemplate(toInput(s, ctx), ctx.theme, ctx.stage, { diagramWarnings: true });
    if (!warned.diagram?.length && warned.diagramWarnings?.length) r = warned;
  }
  // A tile whose diagram the layout could not show (TEACH-75 part d), by its key.
  const pre = str(normalise(s).template) === "compare" ? "col" : "seq";
  const lost = (r.lost ?? []).map((n) => `${pre}.${n}`);
  // A diagram the layout dropped is missing: the slide is laid out again with its `ask_without` lines.
  if (r.diagram?.length) {
    const why = r.diagram;
    const missing = new Set([
      ...["picture", "diagram", "figure"].filter((k) => ctx.visual(k).status === "diagram"),
      ...lost,
    ]);
    r = { ...layoutTemplate(toInput(s, ctx, false, missing), ctx.theme, ctx.stage), diagram: why };
  }
  const slide = { ...r.slide, kind: kindByRole(s, ctx, r.slide.kind) };
  // PROTOTYPE (pilot/integration only; belongs to TEACH-110 part s): an adaptive pilot layout stays
  // a component in the editor. Its elements go into one group that keeps the template and input
  // (`layoutGroup`), so the teacher's add, delete and typing re-flow it (TEACH-205 part b).
  const template = str(normalise(s).template);
  if (ADAPTIVE.has(template) && !r.diagram?.length) {
    const input = toInput(s, ctx) as unknown as Record<string, unknown>;
    const group = layoutGroup(
      { template: template as "items-row", input },
      ctx.theme,
      ctx.stage,
      `${stableIdPrefix(ctx.index)}layout`,
    );
    slide.elements = [{ ...group, authoredBy: "ai" } as unknown as Slide["elements"][number]];
  }
  return aiAuthored({
    slide,
    over: r.over,
    ...(r.diagram ? { diagram: r.diagram } : {}),
    ...(r.diagramWarnings ? { diagramWarnings: r.diagramWarnings } : {}),
    ...(lost.length ? { lost } : {}),
  });
}

/**
 * A question set is a starter ("Do now") only before the deck's first teaching slide; after it the
 * slide role is check, laid as open-response questions like practice (prod-11, the slide-role
 * contract). Every other template keeps its kind.
 */
function kindByRole(s: S, ctx: MaterialiseCtx, kind: Slide["kind"]): Slide["kind"] {
  if (kind !== "starter") return kind;
  const slides = (ctx.plan.slides ?? []) as (S | undefined)[];
  const role = slideRole(s, { index: ctx.index, firstTeaching: firstTeaching(slides) });
  return role === "check" ? "open-response" : kind;
}

/** The objectives slide from the approved objectives (the writer never writes slide 2). */
export function codeObjectives(ctx: Omit<MaterialiseCtx, "visual">): Materialised {
  const r = layoutTemplate(
    toInput({ template: "objectives" }, { ...ctx, visual: () => ({ status: "pending" }) }),
    ctx.theme,
    ctx.stage,
  );
  return aiAuthored({ slide: r.slide, over: r.over });
}

/** The title slide in code from the brief, before the writer answers. */
export function codeTitle(brief: Brief, ctx: { theme: Theme; stage: Stage }): Materialised {
  const r = layoutTemplate(
    { template: "title", heading: brief.topic, lead: `${brief.yearGroup} ${brief.subject}` },
    ctx.theme,
    ctx.stage,
  );
  return aiAuthored({ slide: r.slide, over: r.over });
}

/** The questions on a slide (the answerable check and the notes' answers). */
export function questionsOf(raw: S): string[] {
  const s = normalise(raw);
  if (s.template === "hinge") return [str(s.stem) || str(s.heading)];
  if (["question-set", "practice", "exit-ticket"].includes(str(s.template)))
    return strs(Array.isArray(s.items) ? s.items : s.questions);
  // A discussion question has no one answer: it is not checked for one.
  return [];
}

/** The slide's own words (checks and the duplicate test). */
export function wordsOf(raw: S): string {
  const s = resolveAsks(raw, () => true);
  const parts: string[] = [
    str(s.heading),
    str(s.lead),
    str(s.stem),
    str(s.formula),
    str(s.instruction),
    ...pts(s.points).map((p) => (typeof p === "string" ? p : `${p.label}: ${p.text}`)),
    ...strs(s.questions),
    ...strs(s.options),
  ];
  for (const c of (Array.isArray(s.columns) ? s.columns : []) as S[])
    parts.push(str(c.label), str(c.text));
  for (const c of (Array.isArray(s.sequence) ? s.sequence : []) as S[]) parts.push(str(c.caption));
  for (const c of (Array.isArray(s.grid) ? s.grid : []) as S[])
    parts.push(str(c.label), str(c.text));
  parts.push(...activityWords(s));
  return parts.filter(Boolean).join("\n");
}

/* ------------------------------------------------------------------ */
/* End-of-deck answers (TEACH-191 part b)                              */
/* ------------------------------------------------------------------ */

/**
 * The deck as it ships: the practice and exit answers collected on Answers slides behind the guard
 * at the very end (ruling 240), laid out by `@tj/slides` from the slides' own answers. Code, not the
 * writer: the writer's prompt and schema never name the layout. A rebuild replaces the old end.
 * A worksheet with its own answer key keeps them too; the teacher turns them off in the editor
 * (ruling 260).
 */
export function withEndAnswers(slides: Slide[], ctx: { theme: Theme; stage: Stage }): Slide[] {
  const lesson = slides.filter((s) => !s.answersRole);
  return [...lesson, ...endAnswerSlides(answerGroupsOf(lesson), ctx.theme, ctx.stage)];
}
