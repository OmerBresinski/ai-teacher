import type { Slide, Theme } from "@tj/domain/documents";
import { PLACEHOLDER_IMAGE } from "@tj/slides/layouts";
import {
  type Figure,
  layoutTemplate,
  type TemplateInput,
  type TemplatePoint,
} from "@tj/slides/templates";
import { labelsOf, writerSpecOf } from "./diagrams";
import type { Brief, Stage } from "./fixes";

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
};
export type Materialised = {
  slide: Pick<Slide, "kind" | "elements" | "background">;
  over: string[];
  diagram?: string[];
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const strs = (v: unknown) =>
  Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : str((x as S)?.question))) : [];
/** Support points: a string, or `{label, text}` (a key card). A blank label is no label. */
const pts = (v: unknown): TemplatePoint[] =>
  Array.isArray(v)
    ? v.map((x) => {
        if (typeof x === "string") return x;
        const o = (x ?? {}) as S;
        const label = str(o.label).trim();
        return label ? { label, text: str(o.text) } : str(o.text);
      })
    : [];

const isDia = (f: unknown): f is Dia => !!f && typeof f === "object" && "kind" in (f as object);
const isPic = (f: unknown): f is Pic =>
  !!f && typeof f === "object" && "shows" in (f as object) && !("kind" in (f as object));

/** A figure the diagram library draws (`kind: "model"`). */
export const isModel = (f: unknown): boolean =>
  isDia(f) && (f as { kind?: unknown }).kind === "model";

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

/** The pictures and diagrams a slide holds, with stable keys. */
function figures(s: S): { key: string; f: Pic | Dia }[] {
  const out: { key: string; f: Pic | Dia }[] = [];
  for (const k of ["picture", "diagram", "figure"])
    if (isPic(s[k]) || isDia(s[k])) out.push({ key: k, f: s[k] as Pic | Dia });
  (Array.isArray(s.sequence) ? s.sequence : []).forEach((x, n) => {
    if (isPic(x)) out.push({ key: `seq.${n}`, f: x });
  });
  (Array.isArray(s.columns) ? s.columns : []).forEach((c, n) => {
    const p = (c as S)?.picture;
    if (isPic(p)) out.push({ key: `col.${n}`, f: p });
  });
  return out;
}

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
    const d = (v.spec as { drawn?: { src: string; aspect: number; alt?: string; bare?: boolean } })
      ?.drawn;
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
const FIXED_SHAPE = new Set(["compare", "picture-sequence"]);
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
    else s.lead = joined(line(s.lead), l);
  }
  if (Array.isArray(s.columns))
    s.columns = (s.columns as S[]).map((c, n) => {
      const p = c?.picture as S | undefined;
      if (!p || typeof p !== "object" || !("ask" in p || "ask_without" in p)) return c;
      const { ask, ask_without, ...rest } = p;
      const l = placed(`col.${n}`) ? line(ask) : line(ask_without);
      return { ...c, picture: rest, ...(l ? { text: joined(line(c.text), l) } : {}) };
    });
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
      // A picture or diagram that could not be made: the words stand alone, never an empty panel.
      return {
        template: f ? template : "explain",
        heading,
        lead,
        points: pts(s.points),
        figure: f,
      };
    }
    case "big-picture":
    case "big-diagram": {
      const f = fig(template === "big-picture" ? "picture" : "diagram");
      // A library model's slide: heading, the model, and the one-line lead as its takeaway under it.
      return f
        ? { template, heading, lead, figure: f }
        : { template: "explain", heading, lead: lead ?? "" };
    }
    case "picture-sequence": {
      const seq = (Array.isArray(s.sequence) ? s.sequence : []) as (Pic & { caption?: string })[];
      // A sequence with a picture that could not be made: the stages become numbered steps.
      if (seq.some((_, n) => ctx.visual(`seq.${n}`).status === "failed"))
        return lead
          ? { template: "explain", heading, lead, points: seq.map((x) => str(x.caption)) }
          : { template: "steps", heading, points: seq.map((x) => str(x.caption)) };
      return {
        template,
        heading,
        ...(lead ? { lead } : {}),
        sequence: seq.map((x, n) => ({
          caption: str(x.caption),
          figure: figureNow(`seq.${n}`, x, ctx, mark),
        })),
      };
    }
    case "compare": {
      const cols = (Array.isArray(s.columns) ? s.columns : []) as S[];
      // One column's picture missing leaves a hole: every column goes without when any failed.
      const anyFailed = cols.some(
        (c, n) => isPic(c.picture) && ctx.visual(`col.${n}`).status === "failed",
      );
      return {
        template,
        heading,
        ...(lead && !cols.some((c) => isPic(c.picture)) ? { lead } : {}),
        columns: cols.map((c, n) => {
          const p = c.picture;
          const f = isPic(p) && !anyFailed ? figureNow(`col.${n}`, p, ctx, mark) : undefined;
          return { label: str(c.label), text: str(c.text), ...(f ? { figure: f } : {}) };
        }),
      };
    }
    case "steps": {
      // Steps with an ask line read as a lead and points beside the figure.
      const f = fig("figure");
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
    case "hinge":
      return { template, heading, stem: str(s.stem), options: strs(s.options) };
    case "question-set":
    case "practice":
    case "exit-ticket":
      return {
        template,
        heading,
        questions: strs(s.questions),
        ...(s.instruction ? { instruction: str(s.instruction) } : {}),
        figure: fig("picture") ?? fig("figure"),
      };
    case "discussion":
      return {
        template,
        heading,
        lead: lead ?? str(s.question),
        figure: fig("picture") ?? fig("figure"),
      };
    default:
      return {
        template: "explain",
        heading: heading || `Unknown template ${template}`,
        lead: lead ?? "",
      };
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
  const setOf = (key: string) =>
    key.startsWith("seq.") && shows("seq.").length >= 2 ? "seq" : undefined;
  return figs.map(
    ({ key, f }): VisualAsk =>
      isDia(f)
        ? diagramVisualAsk(key, f as unknown as S)
        : {
            key,
            type: "photo",
            shows: f.shows,
            mustSee: f.must_see ?? [],
            named: f.subject === "named",
            ...(slots[key] ? { aspect: slots[key].aspect, fixedShape: slots[key].fixed } : {}),
            ...(setOf(key) ? { set: setOf(key) } : {}),
          },
  );
}

/** Lay one slide out from its JSON and the visuals' current states. */
export function materialise(s: S, ctx: MaterialiseCtx): Materialised {
  let r = layoutTemplate(toInput(s, ctx), ctx.theme, ctx.stage);
  // A diagram the layout dropped is missing: the slide is laid out again with its `ask_without` lines.
  if (r.diagram?.length) {
    const why = r.diagram;
    const missing = new Set(
      ["picture", "diagram", "figure"].filter((k) => ctx.visual(k).status === "diagram"),
    );
    r = { ...layoutTemplate(toInput(s, ctx, false, missing), ctx.theme, ctx.stage), diagram: why };
  }
  return { slide: r.slide, over: r.over, ...(r.diagram ? { diagram: r.diagram } : {}) };
}

/** The objectives slide from the approved objectives (the writer never writes slide 2). */
export function codeObjectives(ctx: Omit<MaterialiseCtx, "visual">): Materialised {
  const r = layoutTemplate(
    toInput({ template: "objectives" }, { ...ctx, visual: () => ({ status: "pending" }) }),
    ctx.theme,
    ctx.stage,
  );
  return { slide: r.slide, over: r.over };
}

/** The title slide in code from the brief, before the writer answers. */
export function codeTitle(brief: Brief, ctx: { theme: Theme; stage: Stage }): Materialised {
  const r = layoutTemplate(
    { template: "title", heading: brief.topic, lead: `${brief.yearGroup} ${brief.subject}` },
    ctx.theme,
    ctx.stage,
  );
  return { slide: r.slide, over: r.over };
}

/** The questions on a slide (the answerable check and the notes' answers). */
export function questionsOf(raw: S): string[] {
  const s = normalise(raw);
  if (s.template === "hinge") return [str(s.stem)];
  if (["question-set", "practice", "exit-ticket"].includes(str(s.template)))
    return strs(s.questions);
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
  return parts.filter(Boolean).join("\n");
}
