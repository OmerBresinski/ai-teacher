// BAKEOFF arm R: the model picks one designer-made reference slide per slide and replaces the
// content of its slots (packages/slides/src/references). Prompt and schema:
// BAKEOFF/prompts/R/{system,schema}.<KS1|KS2|KS3-4|KS5>.{txt,json} (the prompt agent's, built
// from BAKEOFF/catalogue/R.json by prompts/R/make.py). The prompt's menu merges twin references;
// `resolve` maps each entry back to the reference that draws it.
import { readFileSync } from "node:fs";
import { PLACEHOLDER_IMAGE } from "../../packages/slides/src/layouts";
import { editReference, type Figure } from "../../packages/slides/src/references/index";
import type { ArmPlugin, Brief, MaterialiseCtx, VisualAsk } from "./harness";
import { BAKEOFF } from "./services";

type Pic = { shows: string; must_see?: string[]; subject?: "named" | "generic" };
type Dia = { kind: string; shows: string; labels?: string[] };
type S = Record<string, unknown>;
const band = (b: Brief) =>
  b.keyStage === "ks1"
    ? "KS1"
    : b.keyStage === "ks2"
      ? "KS2"
      : b.keyStage === "ks5"
        ? "KS5"
        : "KS3-4";
const str = (v: unknown) => (typeof v === "string" ? v : "");
const strs = (v: unknown) =>
  Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : str((x as S)?.question))) : [];
const objs = (v: unknown) =>
  Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as S[]) : [];
const isDia = (f: unknown): f is Dia => !!f && typeof f === "object" && "kind" in (f as object);
const isPic = (f: unknown): f is Pic =>
  !!f && typeof f === "object" && "shows" in (f as object) && !("kind" in (f as object));
const isVis = (f: unknown): f is Pic | Dia => isPic(f) || isDia(f);

/**
 * The harness's repair step stores the whole repair output `{fix, slide, to_notes}` as the slide
 * (harness.ts, step e); read the slide inside it.
 */
const unwrap = (s: S): S =>
  s && typeof s.fix === "string" && s.slide && typeof s.slide === "object" ? (s.slide as S) : s;

/** Every visual a slide asks for, keyed: `picture` for the slide's own, `frames.N` for a sequence. */
function figures(s: S): { key: string; f: Pic | Dia }[] {
  const out: { key: string; f: Pic | Dia }[] = [];
  if (isVis(s.picture)) out.push({ key: "picture", f: s.picture });
  objs(s.frames).forEach((x, n) => {
    if (isVis(x.picture)) out.push({ key: `frames.${n}`, f: x.picture });
  });
  objs(s.columns).forEach((x, n) => {
    if (isVis(x.picture)) out.push({ key: `columns.${n}`, f: x.picture });
  });
  return out;
}

/** The figure now: landed photo or drawing, an open slot while pending, nothing when it failed. */
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
    };
  if (v.status === "diagram") return { diagram: v.spec };
  if (v.status === "failed") return undefined;
  return {
    photo: PLACEHOLDER_IMAGE,
    alt: isDia(f) ? `Diagram: ${f.shows}` : f.shows,
    ...(isDia(f)
      ? {}
      : { request: mark ? `slot:${key}` : [f.shows, ...(f.must_see ?? [])].join(". ") }),
  };
}

/** Each photo slot's box shape, read off the slide laid out with every visual pending and marked. */
function slotShapes(s: S, vctx: Omit<MaterialiseCtx, "visual">): Record<string, number> {
  const ctx: MaterialiseCtx = { ...vctx, visual: () => ({ status: "pending" }) };
  const out: Record<string, number> = {};
  try {
    const els = editReference(resolve(s, ctx, true), vctx.theme, vctx.stage, { ruler: false }).slide
      .elements;
    for (const e of els) {
      const r = (e as { request?: string }).request;
      if (e.type === "image" && r?.startsWith("slot:"))
        out[r.slice(5)] = Math.round((e.w / e.h) * 100) / 100;
    }
  } catch {
    // unknown entry: no shapes
  }
  return out;
}

/** Prompt entry + its slots -> the reference that draws it and its slot values (pictures resolved). */
/** Direct reference names (as in the prompt's examples) map to their menu entry. */
const ALIAS: Record<string, string> = {
  "explain-picture": "visual-text",
  "explain-diagram": "visual-text",
  "big-picture": "big-visual",
  "big-diagram": "big-visual",
  "steps-wide": "steps",
  "discussion-picture": "discussion",
  "question-figure": "question-set",
};

export function resolve(
  raw: S,
  ctx: MaterialiseCtx,
  mark = false,
): { reference: string; slots: S } {
  const s = unwrap(raw);
  const entry = ALIAS[str(s.reference)] ?? str(s.reference);
  const slots: S = { ...s };
  delete slots.reference;
  delete slots.correct;
  delete slots.notes;
  const ask = s.picture;
  const pic = isVis(ask) ? figureNow("picture", ask, ctx, mark) : undefined;
  if (pic) slots.picture = pic;
  else delete slots.picture;
  const isDiagramAsk = isDia(ask);
  switch (entry) {
    case "objectives":
      return {
        reference: "objectives",
        slots: {
          heading: str(s.heading) || "Today we are learning to",
          items: (ctx.plan.objectives ?? []).map((o) => o.pupil),
        },
      };
    case "visual-text":
      // A picture that could not be made: the words stand alone, never an empty panel.
      return pic
        ? { reference: isDiagramAsk ? "explain-diagram" : "explain-picture", slots }
        : { reference: "explain-keypoint", slots };
    case "big-visual":
      return pic
        ? { reference: isDiagramAsk ? "big-diagram" : "big-picture", slots }
        : { reference: "explain-keypoint", slots: { heading: s.heading, lead: s.caption } };
    case "hook-bleed":
      return pic
        ? { reference: "hook-bleed", slots }
        : {
            reference: "discussion",
            slots: {
              heading: s.heading,
              prompt: s.question ?? s.story,
              support: s.question ? s.story : undefined,
            },
          };
    case "steps":
      return { reference: pic ? "steps" : "steps-wide", slots };
    case "discussion":
      return { reference: pic ? "discussion-picture" : "discussion", slots };
    case "question-set":
      return { reference: pic ? "question-figure" : "question-set", slots };
    case "picture-sequence":
      return {
        reference: "picture-sequence",
        slots: {
          ...slots,
          // A frame whose picture could not be made is dropped while two or more remain.
          frames: ((fr) =>
            fr.filter((x) => x.picture).length >= 2 ? fr.filter((x) => x.picture) : fr)(
            objs(s.frames).map((x, n) => ({
              caption: x.caption,
              picture: isVis(x.picture)
                ? figureNow(`frames.${n}`, x.picture, ctx, mark)
                : undefined,
            })),
          ),
        },
      };
    case "compare": {
      // A column picture that failed drops every column's picture: the cards stay alike.
      const cols = objs(s.columns).map((x, n) => ({
        ...x,
        picture: isVis(x.picture) ? figureNow(`columns.${n}`, x.picture, ctx, mark) : undefined,
      }));
      const all = cols.length > 0 && cols.every((x) => x.picture);
      return {
        reference: "compare",
        slots: { ...slots, columns: cols.map((x) => (all ? x : { ...x, picture: undefined })) },
      };
    }
    default:
      return { reference: entry, slots };
  }
}

export const armR: ArmPlugin = {
  id: "R",
  prompt(brief) {
    const k = band(brief);
    const dir = `${BAKEOFF}/prompts/R`;
    return {
      system: readFileSync(`${dir}/system.${k}.txt`, "utf8"),
      schema: JSON.parse(readFileSync(`${dir}/schema.${k}.json`, "utf8")),
      model: "gpt-6.1-sol",
      effort: "low",
    };
  },
  promptStage: band,
  visuals(raw, index, vctx) {
    const s = unwrap(raw);
    const shapes = slotShapes(s, { ...vctx, index });
    return figures(s).map(
      ({ key, f }): VisualAsk =>
        isDia(f)
          ? { key, type: "diagram", kind: f.kind, shows: f.shows, labels: f.labels ?? [] }
          : {
              key,
              type: "photo",
              shows: f.shows,
              mustSee: f.must_see ?? [],
              named: f.subject === "named",
              // Every R photo box is fixed (the reference never resizes), so every ask is fixed-shape.
              ...(shapes[key] ? { aspect: shapes[key], fixedShape: true } : {}),
            },
    );
  },
  materialise(s, ctx) {
    const input = resolve(s, ctx);
    try {
      const r = editReference(input, ctx.theme, ctx.stage);
      return { slide: r.slide, over: r.over };
    } catch (e) {
      // An entry the engine does not know: the words on a plain explain slide, flagged.
      const r = editReference(
        { reference: "explain-keypoint", slots: { heading: str(s.heading), lead: str(s.lead) } },
        ctx.theme,
        ctx.stage,
      );
      return { slide: r.slide, over: [...r.over, `reference: ${(e as Error).message}`] };
    }
  },
  codeTitle(brief, ctx) {
    const r = editReference(
      {
        reference: "title",
        slots: { title: brief.topic, subtitle: `${brief.yearGroup} ${brief.subject}` },
      },
      ctx.theme,
      ctx.stage,
    );
    return { slide: r.slide, over: r.over };
  },
  questions(raw) {
    const s = unwrap(raw);
    switch (ALIAS[str(s.reference)] ?? str(s.reference)) {
      case "hinge":
        return [[str(s.heading), str(s.stem)].filter(Boolean).join(" ")];
      case "question-set":
      case "exit-ticket":
        return strs(s.questions);
      case "discussion":
        return [str(s.prompt)];
      case "hook-bleed":
        return s.question ? [str(s.question)] : [];
      case "task":
        return [str(s.lead), ...strs(s.parts)].filter(Boolean);
      default:
        return [];
    }
  },
  words(raw) {
    const s = unwrap(raw);
    const parts: string[] = [];
    for (const [k, v] of Object.entries(s)) {
      if (k === "reference" || k === "picture" || k === "correct") continue;
      if (typeof v === "string") parts.push(v);
      else if (Array.isArray(v))
        for (const x of v) {
          if (typeof x === "string") parts.push(x);
          else if (x && typeof x === "object")
            for (const [fk, fv] of Object.entries(x as S))
              if (fk !== "picture" && typeof fv === "string") parts.push(fv);
        }
    }
    return parts.filter(Boolean).join("\n");
  },
};
