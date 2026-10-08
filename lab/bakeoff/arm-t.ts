// BAKEOFF arm T: the model picks one of the fixed templates per slide and fills its slots.
// Prompt and schema: BAKEOFF/prompts/T/{system,schema}.<KS1|KS2|KS3-5>.{txt,json} (the prompt agent's),
// else SOL-SIMPLE's arm T as a stand-in.
import { existsSync, readFileSync } from "node:fs";
import { withProtectedText } from "../../packages/slides/src/diagrams/polish";
import { PLACEHOLDER_IMAGE } from "../../packages/slides/src/layouts";
import {
  type Figure,
  layoutTemplate,
  type TemplateInput,
  type TemplatePoint,
} from "../../packages/slides/src/templates/index";
import { abArm, abFiles, abLib, abR1t3, abR2, abTitleSub } from "./ab/arms";
import { polishTitleLead, protectSources } from "./ab/polish";
import { labelsOf, writerSpecOf } from "./ab/r2";
import { ANY_POINTING } from "./checks";
import type { ArmPlugin, Brief, MaterialiseCtx, VisualAsk } from "./harness";
import { BAKEOFF, ROUNDS } from "./services";

type Pic = { shows: string; must_see?: string[]; subject?: "named" | "generic" };
type Dia = { kind: string; shows: string; labels?: string[] };
type S = Record<string, unknown>;
const band = (b: Brief) => (b.keyStage === "ks1" ? "KS1" : b.keyStage === "ks2" ? "KS2" : "KS3-5");
const str = (v: unknown) => (typeof v === "string" ? v : "");
const strs = (v: unknown) =>
  Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : str((x as S)?.question))) : [];
/** Support points: a string, or `{label, text}` (a key card; round 1). A blank label is no label. */
const pts = (v: unknown): TemplatePoint[] =>
  Array.isArray(v)
    ? v.map((x) => {
        if (typeof x === "string") return x;
        const o = (x ?? {}) as S;
        const label = str(o.label).trim();
        return label ? { label, text: str(o.text) } : str(o.text);
      })
    : [];
/** R2 (b3-r2): a structured figure is the writer's own spec; its words stand in for labels. */
function r2Ask(key: string, f: Record<string, unknown>): VisualAsk | undefined {
  // lib arm: a library model by id; its params are filled and checked after the writer (ab/lib.ts).
  if (abLib() && f.kind === "model")
    return {
      key,
      type: "diagram",
      kind: "model",
      shows: String(f.intent ?? ""),
      labels: [],
      spec: { model: f.model, intent: f.intent, alt: f.alt },
    };
  const spec = abR2() ? writerSpecOf(f) : undefined;
  if (!spec) return undefined;
  return {
    key,
    type: "diagram",
    kind: String(f.kind),
    shows: String(f.shows ?? ""),
    labels: labelsOf(spec),
    spec,
  };
}

const isDia = (f: unknown): f is Dia => !!f && typeof f === "object" && "kind" in (f as object);
const isPic = (f: unknown): f is Pic =>
  !!f && typeof f === "object" && "shows" in (f as object) && !("kind" in (f as object));

/**
 * The T menu's merged entries back to catalogue templates (prompts/PROMPTS.md): `visual-text` is
 * picture-text or diagram-text and `big-visual` big-picture or big-diagram, by the figure's shape
 * (a `kind` = a diagram); the figure moves to the catalogue slot (`picture` / `diagram`).
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
  // No figure at all: the words stand alone.
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
  // R1 stage 2 (b4-r1t2): a question slide's other tiles, each its own picture.
  (Array.isArray(s.tiles) ? s.tiles : []).forEach((x, n) => {
    if (isPic(x)) out.push({ key: `tile.${n + 1}`, f: x });
  });
  (Array.isArray(s.columns) ? s.columns : []).forEach((c, n) => {
    const p = (c as S)?.picture;
    if (isPic(p)) out.push({ key: `col.${n}`, f: p });
  });
  return out;
}

/** The figure a slot shows now: the photo or drawing when it has landed, an open slot while pending, nothing when it failed. */
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
      // b4-r1t3: the director split the slot; its other pictures show as tiles beside this one.
      ...(abR1t3() && v.photo.tiles?.length
        ? {
            tiles: v.photo.tiles.map((t) => ({
              photo: t.src,
              alt: t.alt,
              aspect: t.aspect,
              request: t.request,
            })),
          }
        : {}),
    };
  if (v.status === "diagram") {
    // lib arm: a library model's final build, a PNG placed as a picture in the figure zone.
    const lib = (v.spec as { libDrawn?: { src: string; aspect: number; alt?: string } })?.libDrawn;
    if (lib) return { photo: lib.src, alt: lib.alt ?? "", aspect: lib.aspect };
    const d = (v.spec as { drawn?: { src: string; aspect: number; alt?: string } })?.drawn;
    return d ? { drawn: d } : { diagram: v.spec };
  }
  if (v.status === "failed") return undefined;
  return isDia(f)
    ? { photo: PLACEHOLDER_IMAGE, alt: `Diagram: ${f.shows}` }
    : {
        photo: PLACEHOLDER_IMAGE,
        alt: f.shows,
        request: mark ? `slot:${key}` : [f.shows, ...(f.must_see ?? [])].join(". "),
      };
}

/**
 * b4-r1t3: the writer's tiles (picture = tile 0, `tiles` = tiles 1..) as one grid in the slide's panel.
 * A tile that failed leaves the grid; when the first failed, the next one leads.
 */
export function tiled(
  s: S,
  main: Figure | undefined,
  ctx: MaterialiseCtx,
  mark = false,
): Figure | undefined {
  if (!abR1t3() || !Array.isArray(s.tiles) || !s.tiles.length) return main;
  const rest = (s.tiles as unknown[])
    .map((t, n) => (isPic(t) ? figureNow(`tile.${n + 1}`, t, ctx, mark) : undefined))
    .filter((f): f is Figure => !!f && "photo" in f);
  const all = [
    ...(main && "photo" in main ? [main, ...(main.tiles ?? [])] : main ? [] : []),
    ...rest,
  ];
  if (main && !("photo" in main)) return main;
  const [lead, ...more] = all;
  if (!lead || !("photo" in lead)) return main;
  // Pairs (matching tasks): the writer's tile_mode when it gives one (the schema field is with the
  // prompt-engineer, arms3/r1t3/REQUEST.md); tiles come in the writer's order.
  const mode = ["together", "shuffled"].includes(String(s.tile_mode))
    ? (s.tile_mode as "together" | "shuffled")
    : "grid";
  return more.length ? { ...lead, tiles: more, tileMode: mode } : lead;
}

/** Templates whose photo slots crop to their own box (the rest show a photo at its own shape). */
const FIXED_SHAPE = new Set(["compare", "picture-sequence"]);
/**
 * Each photo slot's shape on this slide, read off the laid-out slide itself: the slide is laid out
 * with every visual pending, each open slot marked with its key, and the slot's box measured.
 */
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

/** A line from an `ask` field, or undefined for null or blank. */
const line = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const joined = (...xs: (string | undefined)[]) => xs.filter(Boolean).join(" ") || undefined;

/**
 * BAKEOFF round 7 (prompts "round 7 draft"): every picture or diagram request carries `ask`, the
 * one line that needs pupils to see the visual, and `ask_without`, the same move standing alone.
 * The slide shows `ask` when its visual is placed and `ask_without` when it is missing, failed or
 * fell back: no slide can point at a visual that is not there. The line joins the slide's own
 * words (the lead, a question set's instruction, a card's text); the ask fields are removed.
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
    else if (tpl === "discussion") s.lead = joined(line(s.lead), l);
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
  // Round 7: a visual counts as placed while it is pending (its slot shows) and once it landed.
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
      // polish arm (uk-seasons fault 1): the subtitle is code's, never the writer's lead (24/24
      // base4 leads were the flow's slide-1 recall prompt).
      return {
        template,
        heading,
        lead: abTitleSub() ? polishTitleLead(ctx.brief) : lead,
        figure: fig("picture"),
      };
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
      // Round 6: a drawing too big for the side panel is laid out by the template, full width under
      // the words (packages/slides templates, diagram-text), before it is given up. The old move to
      // big-diagram here squeezed the bullets into a caption and lost r5 y9 s5 and y12 s4.
      // A picture or diagram that could not be made: the words stand alone (explain), never an empty panel.
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
      return f
        ? { template, heading, lead, figure: f }
        : { template: "explain", heading, lead: lead ?? "" };
    }
    case "picture-sequence": {
      const seq = (Array.isArray(s.sequence) ? s.sequence : []) as (Pic & { caption?: string })[];
      // A sequence with a picture that could not be made reads as captions and arrows over
      // nothing: the stages become numbered steps instead.
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
      // Round 7: steps with an ask line read as a lead and numbered-free points beside the figure.
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
        figure: tiled(s, fig("picture") ?? fig("figure"), ctx, mark),
      };
    case "discussion":
      return {
        template,
        heading,
        lead: lead ?? str(s.question),
        figure: tiled(s, fig("picture") ?? fig("figure"), ctx, mark),
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
 * Round 8 (subject judges, round7/SUBJECT-JUDGES.md, MFL-JUDGE.md): the subject's own specialist
 * practice, one short block per subject family (prompts/shared/subjects/<family>.txt), appended
 * after the shared system text so the cached prefix stays the same across subjects. A subject
 * with no block gets nothing.
 */
const SUBJECT_FAMILY: [RegExp, string][] = [
  [/math|algebra|geometry|statistic|numeracy/i, "maths"],
  [/scien|physic|chemi|biolog/i, "science"],
  [/histor/i, "history"],
  [/geograph/i, "geography"],
  [/english|literature|drama/i, "english"],
  [
    /french|spanish|german|italian|mandarin|chinese|latin|language|mfl|hindi|urdu|arabic/i,
    "languages",
  ],
  [/psycholog|sociolog|economics|politic/i, "social-sciences"],
];
export function subjectBlock(subject: string | undefined): string {
  const fam = SUBJECT_FAMILY.find(([re]) => re.test(subject ?? ""))?.[1];
  const f = fam && `${BAKEOFF}/prompts/shared/subjects/${fam}.txt`;
  return f && existsSync(f) ? `\n${readFileSync(f, "utf8").trim()}\n` : "";
}

export const armT: ArmPlugin = {
  id: "T",
  prompt(brief) {
    const k = band(brief);
    // A/B (7 Oct): the arm's own pinned system text and code-generated schema; nothing appended.
    const ab = abArm();
    if (ab) {
      const f = abFiles(ab, k);
      return {
        system: readFileSync(f.system, "utf8"),
        schema: JSON.parse(readFileSync(f.schema, "utf8")),
        model: "gpt-6.1-sol",
        effort: "low",
      };
    }
    const dir = `${BAKEOFF}/prompts/T`;
    if (existsSync(`${dir}/system.${k}.txt`) && existsSync(`${dir}/schema.${k}.json`))
      return {
        system: readFileSync(`${dir}/system.${k}.txt`, "utf8") + subjectBlock(brief.subject),
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
  visuals(raw, index, vctx) {
    const s = normalise(raw);
    const slots = slotShapes(s, { ...vctx, index });
    // Pictures meant to be compared on one slide are always made together as one set (Greg, round
    // 3): a sequence's panels, and every compare card's picture. Never part library, part fresh;
    // library reuse is for stand-alone pictures only. `sameSubject` frames the strip.
    const figs = figures(s);
    const shows = (pre: string) =>
      figs.filter(({ key, f }) => key.startsWith(pre) && !isDia(f)).map(({ f }) => f.shows);
    const setOf = (key: string): string | undefined => {
      if (key.startsWith("seq.")) return shows("seq.").length >= 2 ? "seq" : undefined;
      // Round 5 (Sonnet judge, y1 r4 s4-s5: seams and doubled panels): a compare card gets one
      // coherent picture of its own, never a crop of a split strip. Sets are for true sequences.
      if (key.startsWith("col.")) return undefined;
      // b4-r1t3 photo tiles (Greg, 8 Oct): the writer's tiles are one set: real photos per tile when
      // every tile has one, else one generated strip cut apart (services findSet).
      if (
        abR1t3() &&
        Array.isArray(s.tiles) &&
        s.tiles.length &&
        (key === "picture" || key.startsWith("tile."))
      )
        return "tiles";
      return undefined;
    };
    return figs.map(
      ({ key, f }): VisualAsk =>
        isDia(f)
          ? (r2Ask(key, f as unknown as Record<string, unknown>) ?? {
              key,
              type: "diagram",
              kind: f.kind,
              shows: f.shows,
              labels: f.labels ?? [],
            })
          : {
              key,
              type: "photo",
              shows: f.shows,
              mustSee: f.must_see ?? [],
              named: f.subject === "named",
              ...(slots[key] ? { aspect: slots[key].aspect, fixedShape: slots[key].fixed } : {}),
              ...(setOf(key) ? { set: setOf(key) } : {}),
              ...(setOf(key) === "tiles" ? { sameSubject: false } : {}),
            },
    );
  },
  materialise(s, ctx) {
    // D31: a diagram label carrying an objective word, a key term or the slide's own words is never
    // dropped for a clash (read only under polish2's per-label gate).
    return withProtectedText(protectSources(s, ctx.plan), () => materialiseT(s, ctx));
  },
  asWords(raw, opts) {
    // Round 7: the slide has lost its visual, so every ask line is its stand-alone form.
    const s = resolveAsks(raw, () => false);
    // Round 8 (boundary audit B8): no regex judges which sentences point at the visual; the
    // writer's ask / ask_without pair is the only swap. The words stay as written.
    void opts;
    const drop = (t: unknown) => str(t);
    const POINTS = /$^/;
    // Round 9 (regression audit cause 4): no "a; b; c" label string. A diagram's labels mean
    // something only in its geometry; the slide is rewritten to stand alone instead (harness
    // `fallback`, one small call), never padded with the figure's labels.
    const kept: string[] = [];
    const { figure: _f, picture: _p, ...rest } = s as S;
    const tpl = String(s.template);
    return {
      ...rest,
      template: ["diagram-text", "picture-text", "big-diagram", "big-picture"].includes(tpl)
        ? "explain"
        : tpl,
      lead: drop(s.lead),
      ...(Array.isArray(s.points)
        ? {
            points: [
              ...(s.points as unknown[]).filter(
                (p) => !POINTS.test(typeof p === "string" ? p : str((p as S).text)),
              ),
              ...kept,
            ],
          }
        : kept.length
          ? { points: kept }
          : {}),
      // Round 6: questions that need the missing visual go too.
      ...(Array.isArray(s.questions)
        ? { questions: (s.questions as unknown[]).filter((q) => !POINTS.test(str(q))) }
        : {}),
      ...(typeof s.prompt === "string" ? { prompt: drop(s.prompt) } : {}),
      ...(typeof s.stem === "string" ? { stem: drop(s.stem) } : {}),
    };
  },
  asTableText(raw, table) {
    const s = resolveAsks(raw, () => false);
    const { header, rows } = table;
    // A cell, with its column's header when there is one ("Paper marks: 250").
    const cell = (r: string[], k: number) => (header?.[k] ? `${header[k]}: ${r[k]}` : (r[k] ?? ""));
    // A column whose cells are all the same says nothing per row ("Bread: Loaf"): it goes in the lead.
    const cols = (rows[0] ?? []).map((_, k) => k);
    const same = cols.filter(
      (k) => k > 0 && rows.length > 1 && rows.every((r) => r[k] === rows[0]?.[k]),
    );
    const keep = cols.filter((k) => k > 0 && !same.includes(k));
    const rest = (r: string[]) =>
      keep
        .map((k) => cell(r, k))
        .filter((x) => x.trim())
        .join("; ");
    const constant = same.map((k) => cell(rows[0] ?? [], k)).join("; ");
    const lead = [str(s.lead), constant ? `${constant}.` : ""].filter(Boolean).join(" ");
    const name = (r: string[]) =>
      header?.[0] && /^\d/.test(r[0] ?? "") ? `${header[0]} ${r[0]}` : (r[0] ?? "");
    // Two to four rows: one card each, as a compare (round 5 y9 "Who lost?" cards read well).
    if (rows.length >= 2 && rows.length <= 4 && keep.length)
      return {
        template: "compare",
        heading: str(s.heading),
        ...(lead ? { lead } : {}),
        columns: rows.map((r) => ({ label: name(r), text: rest(r), picture: null })),
      };
    return {
      template: "explain",
      heading: str(s.heading),
      lead,
      points: rows.map((r) => (keep.length ? { label: name(r), text: rest(r) } : name(r))),
    };
  },
  asDiagram(raw, which) {
    const s = { ...raw };
    const swap: Record<string, [string, string]> = {
      "picture-text": ["diagram-text", "diagram"],
      "big-picture": ["big-diagram", "diagram"],
      "visual-text": ["visual-text", "figure"],
      "big-visual": ["big-visual", "figure"],
    };
    for (const k of ["picture", "figure"]) {
      const f = s[k];
      if (!isPic(f) || isDia(f) || !which(str(f.shows))) continue;
      const { must_see: _m, subject: _s, ...rest } = f as S;
      const dia = { ...rest, kind: "labelled-diagram", labels: [] };
      const to = swap[str(s.template)];
      delete s[k];
      if (to) {
        s.template = to[0];
        s[to[1]] = dia;
      } else s[k] = dia;
      return s;
    }
    return undefined;
  },
  asPicture(raw) {
    // Round 2: a diagram of a real thing that could not draw becomes a picture of the same thing.
    const s = { ...raw };
    const swap: Record<string, [string, string]> = {
      "diagram-text": ["picture-text", "picture"],
      "big-diagram": ["big-picture", "picture"],
    };
    for (const k of ["figure", "diagram", "picture"]) {
      const f = s[k];
      if (!isDia(f)) continue;
      // Round 7: an ask written for the drawing ("read the gradient") may not fit a photo of the
      // thing, so the picture carries the stand-alone line either way.
      const alone = (f as S).ask_without ?? null;
      // Round 8 (audit 9): the drawing's labels name what pupils must see in the picture.
      const labels = Array.isArray((f as S).labels) ? ((f as S).labels as unknown[]).map(str) : [];
      const pic = {
        shows: f.shows,
        must_see: labels.filter((l) => l.trim().length > 1).slice(0, 4),
        subject: "generic",
        ask: alone,
        ask_without: alone,
      };
      const to = swap[str(s.template)];
      delete s[k];
      if (to) {
        s.template = to[0];
        s[to[1]] = pic;
      } else s[k === "diagram" ? "picture" : k] = pic;
      return s;
    }
    return undefined;
  },
  placeholder(f, ctx) {
    // Provisional from the flow entry alone: its job as the heading, the layout shape its
    // look implies, picture slots open (their pictures are already being found).
    const slot = { photo: PLACEHOLDER_IMAGE, alt: f.look?.shows ?? "" };
    const heading = f.does;
    const kind = f.look?.kind;
    const input: TemplateInput =
      kind === "picture"
        ? { template: "picture-text", heading, figure: slot }
        : kind === "picture-sequence"
          ? {
              template: "picture-sequence",
              heading,
              sequence: [0, 1, 2].map(() => ({ caption: "", figure: slot })),
            }
          : kind === "diagram"
            ? {
                template: "diagram-text",
                heading,
                figure: { ...slot, alt: `Diagram: ${f.look?.shows ?? ""}` },
              }
            : { template: "explain", heading, lead: "" };
    const r = layoutTemplate(input, ctx.theme, ctx.stage);
    return { slide: r.slide, over: [] };
  },
  codeObjectives(ctx) {
    const r = layoutTemplate(
      toInput({ template: "objectives" }, { ...ctx, visual: () => ({ status: "pending" }) }),
      ctx.theme,
      ctx.stage,
    );
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
  questions(raw) {
    const s = normalise(raw);
    if (s.template === "hinge") return [str(s.stem)];
    if (["question-set", "practice", "exit-ticket"].includes(str(s.template)))
      return strs(s.questions);
    // A discussion question has no one answer: it is not checked for one (rerun s6 false positive).
    return [];
  },
  words(raw) {
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
    for (const c of (Array.isArray(s.sequence) ? s.sequence : []) as S[])
      parts.push(str(c.caption));
    return parts.filter(Boolean).join("\n");
  },
};

/** materialise without the D31 protected-label scope. */
function materialiseT(s: S, ctx: MaterialiseCtx) {
  let r = layoutTemplate(toInput(s, ctx), ctx.theme, ctx.stage);
  // Round 7: a diagram the layout dropped is missing: the slide is laid out again with its
  // `ask_without` lines (the drawer's reasons are kept for the checks).
  if (r.diagram?.length) {
    const why = r.diagram;
    const missing = new Set(
      ["picture", "diagram", "figure"].filter((k) => ctx.visual(k).status === "diagram"),
    );
    r = {
      ...layoutTemplate(toInput(s, ctx, false, missing), ctx.theme, ctx.stage),
      diagram: why,
    };
  }
  return { slide: r.slide, over: r.over, ...(r.diagram ? { diagram: r.diagram } : {}) };
}
