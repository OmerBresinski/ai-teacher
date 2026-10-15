import type { FieldReport } from "@tj/slides/templates";
import { type MaterialiseCtx, pilotFit, STABLE_ID_TEMPLATES } from "./materialise";
import { whenNonFatal } from "./services";

/*
 * Validate and repair (TEACH-110 part s): a pilot layout's words are measured at the size they are
 * drawn, after the writer's slide arrives. A field past its cap goes back in one bounded repair
 * call; whatever is still over after it (or with no repair budget) is cut by code at a sentence,
 * clause or word, so a slide never ships with words clipped by its frame.
 */
type S = Record<string, unknown>;

/** One field past its room, by the writer's own path ("items.1.text"). */
export type PilotOver = {
  path: string;
  chars: number;
  /** The room to cut to: the measured cap, or the hard maximum where the cap is 0 or absent. */
  room: number;
  /** Past the hard maximum: the frame would hide words. */
  clipped: boolean;
};

export const isPilot = (s: S | undefined): boolean =>
  !!s && STABLE_ID_TEMPLATES.has(String(s.template));

/** The laid template's input path as the writer wrote it (panel-list rows are `items`). */
export function writerPath(laid: string, writerTemplate: string, path: string): string {
  if (writerTemplate !== "panel-list") return path;
  if (laid === "side-by-side")
    return path.replace(/^sides\.(\d+)\.title$/, "items.$1.name").replace(/^sides\./, "items.");
  return path.replace(/^rows\./, "items.");
}

/** Fields past their room, plus how many members the layout holds when there are too many. */
export function pilotOvers(s: S, ctx: MaterialiseCtx): { overs: PilotOver[]; tooMany: boolean } {
  const fit = pilotFit(s, ctx);
  const overs = (fit.fields as FieldReport[]).flatMap((f): PilotOver[] => {
    const room = f.cap && f.cap > 0 ? f.cap : (f.hardMax ?? 0);
    const past = f.over || (!!f.cap && f.cap > 0 && f.chars > f.cap);
    if (!past || room <= 0) return [];
    const clipped = f.over || (f.hardMax != null && f.chars > f.hardMax);
    return [
      { path: writerPath(fit.template, String(s.template), f.path), chars: f.chars, room, clipped },
    ];
  });
  // A count past the layout's maximum ("items", "rows 6/5", "sides 4/3").
  const tooMany = fit.over.some((o) => {
    const m = /^(items|rows|sides)(?: (\d+)\/(\d+))?$/.exec(o);
    if (!m) return false;
    const k = m[1] === "sides" ? membersKey(s) : "items";
    const list = s[k];
    return m[2] ? Number(m[2]) > Number(m[3]) : Array.isArray(list) && list.length > 2;
  });
  return { overs, tooMany };
}

/** The fault line a repair call reads for one field, in characters. */
export const overFault = (o: PilotOver) =>
  `overflow: ${o.path} is ${o.chars} characters, room ${o.room}${o.clipped ? " (words hidden)" : ""}`;

/**
 * `text` cut back to its last whole sentence within `room` characters, or nothing when no whole
 * sentence fits. Code never cuts inside a sentence: a clause or word cut can change what the slide
 * says ("…pass between blood."), so a field with no sentence to stop at is left whole.
 */
export function sentenceCut(text: string, room: number): string | undefined {
  const t = text.trim();
  if (t.length <= room) return t;
  const head = t.slice(0, room + 1);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  return end > 0 ? t.slice(0, end + 1) : undefined;
}

/** The second repair's fault line: the field's exact budget in characters. */
export const budgetFault = (o: PilotOver) =>
  `overflow: ${o.path} is ${o.chars} characters: rewrite it whole, as a complete sentence, in at most ${o.room} characters`;

const setPath = (s: S, path: string, value: string): S => {
  const out = structuredClone(s) as S;
  const keys = path.split(".");
  let at: Record<string, unknown> = out;
  for (const k of keys.slice(0, -1)) {
    const next = (at as Record<string, unknown>)[k];
    if (!next || typeof next !== "object") return s;
    at = next as Record<string, unknown>;
  }
  const last = keys[keys.length - 1] as string;
  if (typeof at[last] !== "string") return s;
  at[last] = value;
  return out;
};
const getPath = (s: S, path: string): unknown =>
  path.split(".").reduce<unknown>((a, k) => (a as Record<string, unknown> | undefined)?.[k], s);

/** Members' array of a pilot slide as the writer wrote it. */
const membersKey = (s: S) => (s.template === "split-compare" ? "sides" : "items");

/**
 * The code step, last: a field the frame would hide is cut back to a whole sentence that fits, and
 * a count past the maximum loses its last members. A field with no sentence to stop at is left
 * whole (`kept`), so the slide is still over and the editor shows its chip. Checked by measuring.
 */
export function trimPilot(
  s: S,
  ctx: MaterialiseCtx,
  passes = 3,
): { slide: S; cut: string[]; kept: string[]; ok: boolean } {
  let slide = s;
  const cut: string[] = [];
  const kept = new Set<string>();
  for (let pass = 0; pass < passes; pass++) {
    const { overs: all, tooMany } = pilotOvers(slide, ctx);
    const overs = all.filter((o) => o.clipped && !kept.has(o.path));
    if (!overs.length && !tooMany) break;
    if (tooMany) {
      const k = membersKey(slide);
      const list = slide[k];
      if (Array.isArray(list) && list.length > 2) {
        slide = { ...slide, [k]: list.slice(0, -1) };
        cut.push(`${k}.${list.length - 1}`);
        continue;
      }
    }
    for (const o of overs) {
      const v = getPath(slide, o.path);
      if (typeof v !== "string") continue;
      const next = sentenceCut(v, Math.max(1, Math.floor(o.room * (1 - 0.1 * pass))));
      if (next === undefined || next === v) {
        kept.add(o.path);
        continue;
      }
      slide = setPath(slide, o.path, next);
      if (!cut.includes(o.path)) cut.push(o.path);
    }
  }
  const left = pilotOvers(slide, ctx);
  return {
    slide,
    cut,
    kept: [...kept],
    ok: !left.overs.some((o) => o.clipped) && !left.tooMany,
  };
}

/** What the fit step did to one slide. */
export type PilotFitResult = {
  slide: S;
  /**
   * `fits`; `repaired` (first call) or `repaired-budget` (second call, exact budgets); `tight`
   * (past a comfort cap, nothing hidden: kept); `trimmed` (code cut whole sentences or members);
   * `still-over` (a field had no sentence to stop at: left whole, the editor shows the chip).
   */
  path: "fits" | "repaired" | "repaired-budget" | "tight" | "trimmed" | "still-over";
  overs: PilotOver[];
  /** Every step taken, in order, for the log. */
  steps: string[];
  cut?: string[];
  kept?: string[];
};

/**
 * Validate and repair one pilot slide. `repair` is a bounded call (absent: no budget, straight to
 * the code step); it gets the slide and fault lines and returns a slide or nothing. First call: the
 * fields past their cap. If anything would still be hidden, a second call with each field's exact
 * budget. Only then the code step, which cuts whole sentences only. A repaired slide counts only
 * when it is the same layout.
 */
export async function fitPilot(
  s: S,
  ctx: MaterialiseCtx,
  repair?: (slide: S, faults: string[]) => Promise<S | undefined>,
): Promise<PilotFitResult> {
  const first = pilotOvers(s, ctx);
  const steps: string[] = [];
  if (!first.overs.length && !first.tooMany) return { slide: s, path: "fits", overs: [], steps };
  const broken = (o: { overs: PilotOver[]; tooMany: boolean }) =>
    o.overs.some((x) => x.clipped) || o.tooMany;
  const tooManyLine = (x: S) => `overflow: ${membersKey(x)} more than the layout holds`;
  let from = s;
  let left = first;
  const call = async (faults: string[], label: string) => {
    if (!repair) return false;
    const r = await repair(from, faults).catch(whenNonFatal(() => undefined));
    if (!r || r.template !== s.template) {
      steps.push(`${label}: ${r ? "changed layout, dropped" : "no slide"}`);
      return false;
    }
    from = r;
    left = pilotOvers(r, ctx);
    steps.push(
      `${label}: ${left.overs.length} over, ${left.overs.filter((o) => o.clipped).length} hidden`,
    );
    return true;
  };
  await call([...first.overs.map(overFault), ...(first.tooMany ? [tooManyLine(s)] : [])], "repair");
  if (!left.overs.length && !left.tooMany && from !== s)
    return { slide: from, path: "repaired", overs: first.overs, steps };
  if (broken(left)) {
    await call(
      [
        ...left.overs.filter((o) => o.clipped).map(budgetFault),
        ...(left.tooMany ? [tooManyLine(from)] : []),
      ],
      "repair-budget",
    );
    if (!broken(left) && from !== s)
      return {
        slide: from,
        path: left.overs.length ? "tight" : "repaired-budget",
        overs: first.overs,
        steps,
      };
  }
  if (!broken(left)) return { slide: from, path: "tight", overs: first.overs, steps };
  const t = trimPilot(from, ctx);
  steps.push(
    `code: cut ${t.cut.join(", ") || "nothing"}${t.kept.length ? `; kept whole ${t.kept.join(", ")}` : ""}`,
  );
  return {
    slide: t.slide,
    path: t.ok ? "trimmed" : "still-over",
    overs: first.overs,
    steps,
    cut: t.cut,
    kept: t.kept,
  };
}

const FIGURE_KEYS = new Set(["picture", "diagram", "panelPic", "icon"]);
/**
 * A pilot fit repair rewrites words only: every picture, diagram and icon comes back as the writer
 * gave it, whatever the small model returned for it (live proof y6-heart s4: a repair that dropped
 * the panel's picture was refused, so a two-character overflow was never fixed).
 */
export function carryFigures(before: unknown, after: unknown): S {
  const walk = (b: unknown, a: unknown): unknown => {
    if (Array.isArray(b) && Array.isArray(a))
      return a.map((x, k) => (k < b.length ? walk(b[k], x) : x));
    if (!b || !a || typeof b !== "object" || typeof a !== "object") return a;
    const out: S = { ...(a as S) };
    for (const [k, v] of Object.entries(b as S)) {
      if (FIGURE_KEYS.has(k)) out[k] = v;
      else if (k in out) out[k] = walk(v, out[k]);
    }
    return out;
  };
  return walk(before, after) as S;
}
