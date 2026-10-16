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

/** Letters of a script an English lesson never writes in (a decoding slip, e.g. '水' in a title). */
const STRAY_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thai}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Tamil}\p{Script=Georgian}\p{Script=Armenian}\p{Script=Ethiopic}]/u;
/** Words a whole name or title never ends on: one that does was cut mid-phrase. */
const FUNCTION_WORDS = new Set(
  "a an the of to in on at by for with from and or but nor as than that which who whom whose what how why when where if so is are was were be been can could will would should may might must do does did has have had its their his her our your my this these those into onto about over under between".split(
    " ",
  ),
);
const endsCut = (t: unknown) => {
  const w = String(t ?? "")
    .trim()
    .replace(/[:,;-]+$/, "")
    .split(/\s+/)
    .filter(Boolean);
  return w.length > 0 && FUNCTION_WORDS.has((w.at(-1) as string).toLowerCase());
};

/**
 * The slips a strict decoder lets through (smoke-real2 NOTES, checks 4): a letter of a non-Latin
 * script in any string; a side title or item name ending on a function word; a side's text that
 * starts lower-case (the rest of a title cut short). Fault lines for the one repair call.
 */
export function pilotSlips(s: S): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === "string") {
      const m = STRAY_SCRIPT.exec(v);
      if (m) out.push(`stray script: ${path} has '${m[0]}': write it in English`);
    } else if (Array.isArray(v)) {
      for (const [i, x] of v.entries()) walk(x, path ? `${path}.${i}` : String(i));
    } else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v as S))
        if (k !== "picture" && k !== "icon") walk(x, path ? `${path}.${k}` : k);
  };
  walk(s, "");
  const list = (k: string) => (Array.isArray(s[k]) ? (s[k] as S[]) : []);
  list("sides").forEach((x, i) => {
    if (endsCut(x?.title))
      out.push(
        `split title: sides.${i}.title ends mid-phrase: name the thing whole, the rest goes in its text`,
      );
    const t = String(x?.text ?? "").trimStart();
    if (/^\p{Ll}/u.test(t))
      out.push(
        `split title: sides.${i}.text starts lower-case: it carries the end of the title; make each whole`,
      );
  });
  if (s.template !== "split-compare")
    list("items").forEach((x, i) => {
      if (endsCut(x?.name)) out.push(`split title: items.${i}.name ends mid-phrase: name it whole`);
    });
  return out;
}

/**
 * Members past what the layout holds are never dropped: the slide is re-laid as a panel list (the
 * set layout that holds the most), kept only when that holds every member at the drawn size.
 * Nothing that holds them: the slide stays whole and over, and the editor offers Split.
 */
export function relayMembers(s: S, ctx: MaterialiseCtx): S | undefined {
  if (s.template === "panel-list") return undefined;
  const k = membersKey(s);
  const list = Array.isArray(s[k]) ? (s[k] as S[]) : [];
  const items = list.map((m) => ({
    name: String((k === "sides" ? m?.title : m?.name) ?? ""),
    text: String(m?.text ?? ""),
    icon: k === "items" && typeof m?.icon === "string" ? m.icon : null,
    picture: null,
  }));
  const relaid: S = {
    template: "panel-list",
    heading: s.heading,
    lead: typeof s.lead === "string" ? s.lead : null,
    panel: null,
    items,
  };
  const left = pilotOvers(relaid, ctx);
  return left.tooMany || left.overs.some((o) => o.clipped) ? undefined : relaid;
}

/**
 * The code step, last: a field the frame would hide is cut back to a whole sentence that fits. A
 * field with no sentence to stop at is left whole (`kept`), so the slide is still over and the
 * editor shows its chip. Members are never cut here (`relayMembers`). Checked by measuring.
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
    const overs = pilotOvers(slide, ctx).overs.filter((o) => o.clipped && !kept.has(o.path));
    if (!overs.length) break;
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
   * `fits`; `repaired` (the one call fixed it); `relaid` (members past the layout's most, re-laid
   * as a panel list that holds them); `tight` (past a comfort cap, nothing hidden: kept); `trimmed`
   * (code cut whole sentences); `still-over` (a field had no sentence to stop at, or members no
   * layout holds: left whole, the editor shows the chip and offers Split).
   */
  path: "fits" | "repaired" | "relaid" | "tight" | "trimmed" | "still-over";
  overs: PilotOver[];
  /** Every step taken, in order, for the log. */
  steps: string[];
  cut?: string[];
  kept?: string[];
  /** Slips the one repair left (stray script, split titles): logged, never guessed at by code. */
  slips?: string[];
  /** Members past the layout's most that nothing re-lays: kept, never dropped. */
  membersOver?: boolean;
};

/**
 * Validate and repair one pilot slide. `repair` is ONE bounded call (absent: no budget, straight to
 * the code steps); it gets the slide and the fault lines (each over field with its exact budget,
 * too many members, slips) and returns a slide or nothing. A repaired slide counts only when it is
 * the same layout. Then members past the most are re-laid, never dropped, and code cuts whole
 * sentences only.
 */
export async function fitPilot(
  s: S,
  ctx: MaterialiseCtx,
  repair?: (slide: S, faults: string[]) => Promise<S | undefined>,
): Promise<PilotFitResult> {
  const first = pilotOvers(s, ctx);
  const slips0 = pilotSlips(s);
  const steps: string[] = [];
  if (!first.overs.length && !first.tooMany && !slips0.length)
    return { slide: s, path: "fits", overs: [], steps };
  const broken = (o: { overs: PilotOver[]; tooMany: boolean }) =>
    o.overs.some((x) => x.clipped) || o.tooMany;
  let from = s;
  let left = first;
  if (repair) {
    const faults = [
      ...first.overs.map((o) => (o.clipped ? budgetFault(o) : overFault(o))),
      ...(first.tooMany ? [`overflow: ${membersKey(s)} more than the layout holds`] : []),
      ...slips0,
    ];
    const r = await repair(s, faults).catch(whenNonFatal(() => undefined));
    if (!r || r.template !== s.template)
      steps.push(`repair: ${r ? "changed layout, dropped" : "no slide"}`);
    else {
      from = r;
      left = pilotOvers(r, ctx);
      steps.push(
        `repair: ${left.overs.length} over, ${left.overs.filter((o) => o.clipped).length} hidden`,
      );
    }
  }
  const slips = pilotSlips(from);
  const extra = { ...(slips.length ? { slips } : {}) };
  if (!broken(left) && from !== s)
    return {
      slide: from,
      path: left.overs.length ? "tight" : "repaired",
      overs: first.overs,
      steps,
      ...extra,
    };
  let relaid = false;
  let membersOver = false;
  if (left.tooMany) {
    const r = relayMembers(from, ctx);
    if (r) {
      from = r;
      left = pilotOvers(r, ctx);
      relaid = true;
      steps.push("code: re-laid as a panel list, every member kept");
    } else {
      membersOver = true;
      steps.push("code: members past the layout's most, kept whole (Split)");
    }
  }
  const more = { ...extra, ...(membersOver ? { membersOver } : {}) };
  if (!left.overs.some((o) => o.clipped))
    return {
      slide: from,
      path: membersOver ? "still-over" : relaid ? "relaid" : "tight",
      overs: first.overs,
      steps,
      ...more,
    };
  const t = trimPilot(from, ctx);
  steps.push(
    `code: cut ${t.cut.join(", ") || "nothing"}${t.kept.length ? `; kept whole ${t.kept.join(", ")}` : ""}`,
  );
  return {
    slide: t.slide,
    path: t.ok && !membersOver ? "trimmed" : "still-over",
    overs: first.overs,
    steps,
    cut: t.cut,
    kept: t.kept,
    ...more,
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
