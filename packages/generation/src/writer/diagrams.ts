/**
 * The writer's diagrams (TEACH-247, R2; ported from lab/ab 92f1b36d `lab/bakeoff/ab/r2.ts`,
 * `arm-t.ts` `r2Ask` and the drawer fallback in `services.ts`).
 *
 * The writer writes a structured diagram's spec itself, in the slot's own strict def; code draws it
 * with no model call. A spec that does not parse or fit, and every freeform kind, goes to the
 * drawer call (gpt-6-luna) as its request: base4's round 5 drawer, one retry told the fault. When
 * that fails too, the writer stage's chain takes over (FOR-CODE item 5: repair once, then restage).
 *
 * Nothing here reads or writes prompt text: the drawer's system text is the writer stage's pinned
 * `diagram-spec` prompt, handed in by the caller. Never throws.
 */
import type { ImageElement, Theme } from "@tj/domain/documents";
import { buildCount, svgOfDataUrl } from "@tj/slides/diagram-builds";
import {
  DIAGRAM_KINDS,
  type DiagramKind,
  type DiagramSlot,
  DiagramSpecSchema,
  diagramJsonSchema,
  drawDiagram,
  drawerJsonSchema,
  dropNulls,
  fromMeaning,
  MEANING_SCHEMAS,
  meaningFaults,
  mendSpec,
  parseDiagram,
  SLOT_LIMITS,
  type StageGroup,
  slotBox,
  slotLimit,
  strictForm,
  withAskedCounts,
  withBuilds,
  withLongLabels,
} from "@tj/slides/diagrams";
import { layoutTemplate } from "@tj/slides/templates";
import { atKeyStage } from "@tj/slides/themes";

type J = Record<string, unknown>;

/** RADICAL §R2: the structured kinds the writer specs itself. */
export const R2_KINDS = [
  "bar-model",
  "number-line",
  "line-graph",
  "bar-chart",
  "pie",
  "table",
  "flow",
  "cycle",
  "timeline",
  "layers",
  "venn",
  "carroll",
  "equal-groups",
  "fraction-shapes",
] as const;
export type R2Kind = (typeof R2_KINDS)[number];
const isR2 = (k: unknown): k is R2Kind => (R2_KINDS as readonly unknown[]).includes(k);

/** Kinds that stay `{kind, shows, labels}` and go through the drawer (coordinates, particles, ...). */
export const R2_FREEFORM = DIAGRAM_KINDS.filter((k) => !isR2(k));

/** Each kind's main list in the drawer's schema (meaning form where the drawer fills one). */
export const MAIN_LIST: Record<string, string> = {
  flow: "nodes",
  cycle: "steps",
  timeline: "events",
  table: "rows",
  "labelled-diagram": "labels",
  "bar-chart": "bars",
  pie: "slices",
  venn: "items",
  layers: "layers",
  river: "labels",
  particles: "panels",
  "fraction-shapes": "shapes",
  "line-graph": "annotations",
  "number-line": "points",
  carroll: "cells",
};
/** Kinds whose count is a number, capped at the slot's measured count. */
const COUNT_FIELD: Record<string, string[]> = {
  "equal-groups": ["groups"],
  cubes: ["split"],
  "bar-model": ["bars", "parts"],
};
/** Kinds whose main list is one item per requested label (exactly the requested labels). */
export const EXACT_LABELS = new Set([
  "labelled-diagram",
  "pie",
  "bar-chart",
  "layers",
  "river",
  "cycle",
  "timeline",
]);
const asked = (kind: string, labels: number) =>
  kind === "line-graph" ? Math.max(0, labels - 2) : kind === "table" ? 0 : labels;
/** A schema node, through a nullable anyOf, as the object/array it is (undefined when neither). */
const unwrap = (n: unknown): J | undefined => {
  const o = n as J | undefined;
  if (!o) return undefined;
  if (Array.isArray(o.anyOf)) return (o.anyOf as J[]).find((x) => x.type && x.type !== "null");
  return o;
};

/**
 * The drawer's strict schema with its main list capped at the slot's measured count and at the
 * requested labels, and for EXACT_LABELS kinds held to exactly that many; count fields capped at
 * the slot's count; a title is null only. Never throws.
 */
export function capDrawerSchema(
  schema: J,
  kind: string,
  slotItems: number | undefined,
  labels: number,
): J {
  const out = JSON.parse(JSON.stringify(schema)) as J;
  const props = out.properties as J | undefined;
  if (!props) return out;
  if ("title" in props) props.title = { type: "null" };
  const field = MAIN_LIST[kind];
  const list = field ? unwrap(props[field]) : undefined;
  if (list && list.type === "array") {
    const want = asked(kind, labels);
    const caps = [
      slotItems,
      want > 0 ? want : undefined,
      list.maxItems as number | undefined,
    ].filter((x): x is number => typeof x === "number" && x > 0);
    const min = (list.minItems as number | undefined) ?? 0;
    if (caps.length) list.maxItems = Math.max(min, Math.min(...caps));
    if (kind === "line-graph" && want === 0) list.maxItems = 0;
    if (EXACT_LABELS.has(kind) && want > 0)
      list.minItems = Math.max(min, Math.min(want, list.maxItems as number));
  }
  const path = COUNT_FIELD[kind];
  if (path && slotItems) {
    let node: J | undefined = { properties: props };
    for (const [k, key] of path.entries()) {
      const u = unwrap((node?.properties as J | undefined)?.[key]);
      if (!u) break;
      if (k === path.length - 1) {
        if (u.type === "integer" || u.type === "number")
          u.maximum = Math.max(
            (u.minimum as number | undefined) ?? 0,
            Math.min(slotItems, (u.maximum as number | undefined) ?? slotItems),
          );
        else if (u.type === "array")
          u.maxItems = Math.min(slotItems, (u.maxItems as number | undefined) ?? slotItems);
      } else node = u.type === "array" ? unwrap(u.items) : u;
    }
  }
  return out;
}

/**
 * One kind's writer def in one slot at one stage: the drawer's strict schema, capped at the slot's
 * measured count, the title null, plus `shows`. Undefined when the slot holds none of this kind
 * (KS1 side carroll) or its minimum is over the slot's count. P2b freezes these as
 * `diagram-defs.gen.json`; a test holds the two equal.
 */
export function r2Def(kind: R2Kind, stage: StageGroup, slot: DiagramSlot): J | undefined {
  const lim = SLOT_LIMITS.limits[stage][slot][kind];
  if (lim && lim.items <= 0) return undefined;
  const { $schema: _d, ...open } = drawerJsonSchema(kind as DiagramKind);
  const strict = strictForm(open) as J;
  const field = MAIN_LIST[kind];
  const before = field ? unwrap((strict.properties as J)[field]) : undefined;
  const origMax = before?.maxItems as number | undefined;
  const out = capDrawerSchema(strict, kind, lim?.items, 0);
  const props = out.properties as J;
  const list = field ? unwrap(props[field]) : undefined;
  // capDrawerSchema reads 0 requested labels as "no notes" for a line graph; here the cap is the slot's.
  if (kind === "line-graph" && list && lim)
    list.maxItems = Math.min(origMax ?? lim.items, lim.items);
  if (list && lim && ((list.minItems as number | undefined) ?? 0) > lim.items) return undefined;
  if (lim?.chars && list) {
    const note = `each label at most ${lim.chars} characters in this slot`;
    list.description = list.description ? `${list.description}; ${note}` : note;
  }
  const { kind: k, ...rest } = props;
  out.properties = {
    kind: k,
    shows: { type: "string", description: "what the drawing is for, in a sentence" },
    ...rest,
  };
  out.required = Object.keys(out.properties as J);
  return out;
}

/** The writer's spec on a diagram figure, or undefined for a freeform `{kind, shows, labels}` figure. */
export function writerSpecOf(f: J): J | undefined {
  if (!isR2(f.kind)) return undefined;
  if (
    Array.isArray(f.labels) &&
    Object.keys(f).every((k) => ["kind", "shows", "labels"].includes(k))
  )
    return undefined;
  const { shows: _s, ...spec } = f;
  return spec;
}

/** A spec's words, as the labels a drawer fallback, the checks and the slide's words read. */
export function labelsOf(spec: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown, key = "") => {
    // Numbers are words too (a bar-model whole, a number line's marks); link indices are not.
    if (typeof v === "number" && !["from", "to", "in"].includes(key)) out.push(String(v));
    else if (typeof v === "string") {
      if (!["kind", "alt", "shows", "style", "unknown", "show_count"].includes(key) && v.trim())
        out.push(v.trim());
    } else if (Array.isArray(v)) for (const x of v) walk(x, key);
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v as J)) if (k !== "alt") walk(x, k);
  };
  walk(spec);
  return [...new Set(out)];
}

/** One diagram the writer asked for, as the stage hands it to `drawWriterDiagram`. */
export type WriterDiagramAsk = {
  key: string;
  kind: string;
  shows: string;
  labels: string[];
  /** The writer's own spec (structured kinds); absent for a freeform figure. */
  spec?: unknown;
  /** The slide's words, for the drawer's request. */
  words: string;
  yearGroup: string;
  /** Where the drawing goes (the slot the template gives). */
  slot?: {
    placement: "beside text" | "across the slide";
    w: number;
    h: number;
    name?: DiagramSlot;
  };
  stage?: string;
  /** Question slides keep their answer back: no filled totals, no `combined` (D16 rule 4). */
  question?: boolean;
};

/**
 * `arm-t.ts` `r2Ask` with the freeform branch: a structured figure is the writer's own spec and its
 * words stand in for labels; a freeform figure keeps its labels for the drawer.
 */
export function diagramAskOf(
  key: string,
  f: J,
  ctx: Omit<WriterDiagramAsk, "key" | "kind" | "shows" | "labels" | "spec">,
): WriterDiagramAsk {
  const spec = writerSpecOf(f);
  const base = { key, kind: String(f.kind), shows: String(f.shows ?? ""), ...ctx };
  if (spec) return { ...base, labels: labelsOf(spec), spec };
  const labels = Array.isArray(f.labels) ? f.labels.filter((x) => typeof x === "string") : [];
  return { ...base, labels: labels as string[] };
}

/** Why a spec doesn't draw, in a line ("" when it does): the schema's issues as path: message. */
export function diagramFaultOf(out: unknown, parses: (o: unknown) => unknown): string {
  if (parses(out)) return "";
  const kind = (out as { kind?: unknown })?.kind;
  const own = (
    DiagramSpecSchema.options as unknown as { shape?: { kind?: { value?: unknown } } }[]
  ).find((o) => o.shape?.kind?.value === kind) as typeof DiagramSpecSchema | undefined;
  const r = (own ?? DiagramSpecSchema).safeParse(out);
  if (r.success) return "it did not draw";
  return r.error.issues
    .slice(0, 4)
    .map((i) => `${i.path.map(String).join(".") || "spec"}: ${i.message}`)
    .join("; ");
}

/**
 * Lays the drawing out in its slot and returns the layout's diagram faults (none: it fits). The
 * writer stage passes P2a's `layoutTemplate` probe; with none, the drawing is checked at the
 * slot's own box, which is the box the layout gives it.
 */
export type SlotProbe = (spec: unknown, slot: DiagramSlot, stage: string, theme: Theme) => string[];

const boxProbe: SlotProbe = (spec, slot, stage, theme) => {
  const b = slotBox(stage, slot);
  const r = drawDiagram(
    spec,
    atKeyStage(theme, stage),
    { x: 0, y: 0, w: b.w, h: b.h },
    () => "probe",
  );
  return r.ok ? [] : r.reasons;
};

/** Why the spec does not draw in its own slot ("" when it does). Never throws. */
export function slotFault(
  spec: unknown,
  ask: WriterDiagramAsk,
  theme: Theme,
  probe: SlotProbe = boxProbe,
): string {
  if (!ask.slot) return "";
  try {
    const why = probe(spec, ask.slot.name ?? "side", ask.stage ?? "ks3", theme);
    return why.length
      ? `it does not fit its slot (${ask.slot.w} by ${ask.slot.h} points): ${why.slice(0, 2).join("; ")}`
      : "";
  } catch (e) {
    return `it does not draw: ${String(e).slice(0, 120)}`;
  }
}

/**
 * The writer's spec checked the way the drawer's output is: nulls dropped, a meaning-form spec
 * checked as sent, mended, parsed, and drawn in its own slot. Returns the spec to draw, or the
 * fault that sends it to the drawer. Never throws.
 */
export function acceptWriterSpec(
  spec: unknown,
  ask: WriterDiagramAsk,
  theme: Theme,
  probe?: SlotProbe,
): { spec?: unknown; fault: string } {
  try {
    const sent = dropNulls(spec);
    const meaning =
      typeof (sent as J)?.kind === "string" && ((sent as J).kind as string) in MEANING_SCHEMAS;
    const out = mendSpec(sent);
    const fault =
      meaningFaults(meaning ? sent : out) ||
      diagramFaultOf(out, (o) => withLongLabels(() => parseDiagram(o))) ||
      slotFault(out, ask, theme, probe);
    return fault ? { fault } : { spec: out, fault: "" };
  } catch (e) {
    return { fault: `it does not draw: ${String(e).slice(0, 120)}` };
  }
}

/**
 * A question slide keeps its answer back (D16 rule 4): a bar model shows no combined total and no
 * filled bar total (a "?" total is the question, and stays). Other kinds are returned as they are.
 */
export function questionSafe<T>(spec: T): T {
  const s = spec as J;
  if (!s || typeof s !== "object" || s.kind !== "bar-model") return spec;
  const { combined: _c, ...rest } = s;
  const bars = Array.isArray(rest.bars)
    ? (rest.bars as J[]).map((b) => {
        if (!b || typeof b !== "object" || typeof b.total !== "string" || b.total.includes("?"))
          return b;
        const { total: _t, ...bar } = b;
        return bar;
      })
    : rest.bars;
  return { ...rest, bars } as T;
}

/** The structured call the drawer makes (P1's call on gpt-6-luna, low; not strict). */
export type DrawerCall = (req: {
  model: "gpt-6-luna";
  effort: "low";
  system: string;
  user: string;
  schema: J;
  name: "diagram";
  strict: false;
}) => Promise<{ out?: unknown }>;

export type DrawDeps = {
  callDrawer: DrawerCall;
  /** The writer stage's pinned drawer prompt (`diagram-spec` + the diagram contract). */
  drawerSystem: string;
  theme: Theme;
  probe?: SlotProbe;
  log?: (e: J) => void;
};

export type DrawnWriterDiagram = {
  /** The spec to draw; absent when neither the writer's spec nor the drawer gave one. */
  spec?: unknown;
  /** "code": the writer's spec, no call; "drawer": the fallback call; "none": restage. */
  via: "code" | "drawer" | "none";
  fault: string;
};

/**
 * base4's drawer fallback (`services.ts` specCallsRound5): the wire schema, the request with the
 * writer's spec and why it did not draw, one retry told the parse fault. Never throws.
 */
async function drawerCall(
  ask: WriterDiagramAsk,
  deps: DrawDeps,
): Promise<{ spec?: unknown; fault: string }> {
  if (!(DIAGRAM_KINDS as readonly string[]).includes(ask.kind))
    return { fault: `no drawer for the kind ${ask.kind}` };
  const schema = diagramJsonSchema(ask.kind as DiagramKind);
  const user = `${ask.yearGroup}\nKind: ${ask.kind}\nRequest: ${ask.shows}${ask.labels.length ? `\nLabels: ${ask.labels.join("; ")}` : ""}\n\nThe slide:\n${ask.words}`;
  let fault = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let out: unknown;
    try {
      out = (
        await deps.callDrawer({
          model: "gpt-6-luna",
          effort: "low",
          system: deps.drawerSystem,
          user: fault
            ? `${user}\n\nYour last spec did not draw: ${fault}\nFix that and send it again.`
            : user,
          schema,
          name: "diagram",
          strict: false,
        })
      ).out;
    } catch (e) {
      deps.log?.({ ev: "diagram-call", key: ask.key, attempt, err: String(e).slice(0, 200) });
      return { fault: `the drawer call failed: ${String(e).slice(0, 120)}` };
    }
    fault = out ? diagramFaultOf(out, (o) => withLongLabels(() => parseDiagram(o))) : "no output";
    deps.log?.({ ev: "diagram-call", key: ask.key, attempt, ...(fault ? { fault } : {}) });
    if (!fault) return { spec: out, fault: "" };
  }
  return { fault };
}

/**
 * One diagram the writer asked for, drawn: the writer's spec with no call when it parses and fits;
 * otherwise the drawer gets it as its request (a fallback, not a new stage). On a question slide
 * the answer parts are taken out. Never throws.
 */
export async function drawWriterDiagram(
  ask0: WriterDiagramAsk,
  deps: DrawDeps,
): Promise<DrawnWriterDiagram> {
  let ask = ask0;
  const done = (spec: unknown, via: "code" | "drawer"): DrawnWriterDiagram => ({
    spec: ask0.question ? questionSafe(spec) : spec,
    via,
    fault: "",
  });
  try {
    if (ask.spec !== undefined) {
      const r = acceptWriterSpec(ask.spec, ask, deps.theme, deps.probe);
      deps.log?.({
        ev: r.spec ? "r2-spec-drawn" : "r2-spec-fault",
        key: ask.key,
        kind: ask.kind,
        ...(r.fault ? { fault: r.fault } : {}),
      });
      if (r.spec) return done(r.spec, "code");
      const { spec, ...rest } = ask;
      ask = {
        ...rest,
        shows: `${ask.shows}\nThe writer's spec, which did not draw (${r.fault}): ${JSON.stringify(spec)}`,
      };
    }
    const r = await drawerCall(ask, deps);
    if (r.spec) return done(withAskedCounts(r.spec, ask.labels), "drawer");
    return { via: "none", fault: r.fault };
  } catch (e) {
    return { via: "none", fault: `it does not draw: ${String(e).slice(0, 120)}` };
  }
}

/**
 * The drawn diagram as the slide's image element, through the layout's own path (`drawDiagram`:
 * the spec, then each simpler form, from the zone's label size down), with its builds counted
 * (TEACH-247 part b): the SVG carries each part's build, so Present shows them one per Next and
 * every other surface the whole drawing. Undefined when it cannot be drawn readably.
 */
export function writerDiagramElement(
  spec: unknown,
  theme: Theme,
  stage: string,
  rect: { x: number; y: number; w: number; h: number; fs?: number },
  ids?: () => string,
): ImageElement | undefined {
  try {
    const r = withBuilds(() => drawDiagram(spec, atKeyStage(theme, stage), rect, ids));
    if (!r.ok) return undefined;
    const builds = buildCount(svgOfDataUrl(r.element.src) ?? "");
    return builds ? { ...r.element, builds } : r.element;
  } catch {
    return undefined;
  }
}

/**
 * The lab's slot check (`services.ts` slotFault): the spec laid out in a diagram-text (side) or
 * big-diagram (full) slide by the writer's own layout; its diagram faults, none when it fits.
 */
export const layoutSlotProbe: SlotProbe = (spec, slot, stage, theme) => {
  const r = layoutTemplate(
    {
      template: slot === "full" ? "big-diagram" : "diagram-text",
      heading: "Heading",
      lead: "What this shows.",
      points: ["One point", "Another point"],
      figure: { diagram: fromMeaning(spec) },
    } as never,
    atKeyStage(theme, stage),
    stage as never,
  ) as { diagram?: string[] };
  return r.diagram ?? [];
};

/** The writer's question templates: a drawing there keeps the answer back. */
export const QUESTION_TEMPLATES = new Set(["hinge", "question-set", "practice", "exit-ticket"]);

/** Each drawn diagram on a laid-out slide with its build count (Present plays them). */
export function withBuildCounts<T extends { elements: unknown[] }>(slide: T): T {
  let changed = false;
  const elements = slide.elements.map((e) => {
    const el = e as ImageElement;
    if (el?.type !== "image" || el.name !== "Diagram" || typeof el.src !== "string") return e;
    const n = buildCount(svgOfDataUrl(el.src) ?? "");
    if (!n) return e;
    changed = true;
    return { ...el, builds: n };
  });
  return changed ? { ...slide, elements } : slide;
}

/** The measured slot limit, re-exported for the stage's ask lines. */
export { slotLimit };
