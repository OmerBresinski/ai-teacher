// BAKEOFF arm T: the model picks one of the fixed templates per slide and fills its slots.
// Prompt and schema: BAKEOFF/prompts/T/{system,schema}.<KS1|KS2|KS3-5>.{txt,json} (the prompt agent's),
// else SOL-SIMPLE's arm T as a stand-in.
import { existsSync, readFileSync } from "node:fs";
import { PLACEHOLDER_IMAGE } from "../../packages/slides/src/layouts";
import {
  type Figure,
  layoutTemplate,
  type TemplateInput,
} from "../../packages/slides/src/templates/index";
import type { ArmPlugin, Brief, MaterialiseCtx, VisualAsk } from "./harness";
import { BAKEOFF, ROUNDS } from "./services";

type Pic = { shows: string; must_see?: string[]; subject?: "named" | "generic" };
type Dia = { kind: string; shows: string; labels?: string[] };
type S = Record<string, unknown>;
const band = (b: Brief) => (b.keyStage === "ks1" ? "KS1" : b.keyStage === "ks2" ? "KS2" : "KS3-5");
const str = (v: unknown) => (typeof v === "string" ? v : "");
const strs = (v: unknown) =>
  Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : str((x as S)?.question))) : [];
const isDia = (f: unknown): f is Dia => !!f && typeof f === "object" && "kind" in (f as object);
const isPic = (f: unknown): f is Pic =>
  !!f && typeof f === "object" && "shows" in (f as object) && !("kind" in (f as object));

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

/** The figure a slot shows now: the photo or drawing when it has landed, an open slot while pending, nothing when it failed. */
function figureNow(key: string, f: Pic | Dia, ctx: MaterialiseCtx): Figure | undefined {
  const v = ctx.visual(key);
  if (v.status === "photo") return { photo: v.photo.src, alt: v.photo.alt, aspect: v.photo.aspect };
  if (v.status === "diagram") return { diagram: v.spec };
  if (v.status === "failed") return undefined;
  return isDia(f)
    ? { photo: PLACEHOLDER_IMAGE, alt: `Diagram: ${f.shows}` }
    : { photo: PLACEHOLDER_IMAGE, alt: f.shows };
}

export function toInput(s: S, ctx: MaterialiseCtx): TemplateInput {
  const template = str(s.template) as TemplateInput["template"];
  const heading = str(s.heading);
  const fig = (k: string) => {
    const f = s[k];
    return isPic(f) || isDia(f) ? figureNow(k, f, ctx) : undefined;
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
      return { template, heading, lead, points: strs(s.points) };
    case "picture-text":
    case "diagram-text": {
      const f = fig(template === "picture-text" ? "picture" : "diagram");
      // A picture or diagram that could not be made: the words stand alone (explain), never an empty panel.
      return {
        template: f ? template : "explain",
        heading,
        lead,
        points: strs(s.points),
        figure: f,
      };
    }
    case "big-picture":
    case "big-diagram": {
      const f = fig(template === "big-picture" ? "picture" : "diagram");
      return f
        ? { template, heading, lead, figure: f }
        : { template: "explain", heading, lead: lead ?? "" };
    }
    case "picture-sequence": {
      const seq = (Array.isArray(s.sequence) ? s.sequence : []) as (Pic & { caption?: string })[];
      return {
        template,
        heading,
        sequence: seq.map((x, n) => ({
          caption: str(x.caption),
          figure: figureNow(`seq.${n}`, x, ctx),
        })),
      };
    }
    case "compare": {
      const cols = (Array.isArray(s.columns) ? s.columns : []) as S[];
      return {
        template,
        heading,
        columns: cols.map((c, n) => {
          const p = c.picture;
          const f = isPic(p) ? figureNow(`col.${n}`, p, ctx) : undefined;
          return { label: str(c.label), text: str(c.text), ...(f ? { figure: f } : {}) };
        }),
      };
    }
    case "steps":
      return { template, heading, points: strs(s.points ?? s.steps), figure: fig("figure") };
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

export const armT: ArmPlugin = {
  id: "T",
  prompt(brief) {
    const k = band(brief);
    const dir = `${BAKEOFF}/prompts/T`;
    if (existsSync(`${dir}/system.${k}.txt`) && existsSync(`${dir}/schema.${k}.json`))
      return {
        system: readFileSync(`${dir}/system.${k}.txt`, "utf8"),
        schema: JSON.parse(readFileSync(`${dir}/schema.${k}.json`, "utf8")),
        model: "gpt-6.1-sol",
        effort: "low",
      };
    const sol = `${ROUNDS}/SOL-SIMPLE/prompts`;
    return {
      system: readFileSync(`${sol}/system-T.txt`, "utf8"),
      schema: JSON.parse(readFileSync(`${sol}/schema-T.json`, "utf8")),
      model: "gpt-6.1-sol",
      effort: "low",
    };
  },
  visuals(s) {
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
            },
    );
  },
  materialise(s, ctx) {
    const r = layoutTemplate(toInput(s, ctx), ctx.theme, ctx.stage);
    return { slide: r.slide, over: r.over };
  },
  codeTitle(brief, ctx) {
    const r = layoutTemplate(
      { template: "title", heading: brief.topic, lead: `${brief.yearGroup} ${brief.subject}` },
      ctx.theme,
      ctx.stage,
    );
    return { slide: r.slide, over: r.over };
  },
  questions(s) {
    if (s.template === "hinge") return [str(s.stem)];
    if (["question-set", "practice", "exit-ticket"].includes(str(s.template)))
      return strs(s.questions);
    if (s.template === "discussion") return [str(s.lead ?? s.question)];
    return [];
  },
  words(s) {
    const parts: string[] = [
      str(s.heading),
      str(s.lead),
      str(s.stem),
      str(s.instruction),
      ...strs(s.points),
      ...strs(s.questions),
      ...strs(s.options),
    ];
    for (const c of (Array.isArray(s.columns) ? s.columns : []) as S[])
      parts.push(str(c.label), str(c.text));
    for (const c of (Array.isArray(s.sequence) ? s.sequence : []) as S[])
      parts.push(str(c.caption));
    return parts.filter(Boolean).join("\n");
  },
};
