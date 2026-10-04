import type { Slide } from "@tj/domain/documents";
import {
  contractFits,
  docFromText,
  KIND_TAG_NAME,
  layoutsOf,
  type MaterialiseMeta,
  materialiseSlide,
  type PaletteFormId,
  type SlideSpec,
  type SlideStructure,
  slideFits,
  slotContract,
  specOfWriter,
  THEMES,
  withDiagramDrawn,
} from "@tj/slides";
import { withAnswersReveal } from "../planner/coded-slides";
import { isSetForm, partsField, type SetForm } from "./menu";

/*
 * Plan-write's render and fit (spike/plan-write, step 4): a writer's output becomes its slide spec
 * (`specOfWriter`, or a question set), judged as the slot-contract drift test judges a contract
 * (`contractFits`: the save gate at body size on all 10 themes, every word kept, the form placed as
 * itself, the heading on one line, the reason within its panel). A failing slide gets ONE re-write
 * of the field the failure names, told what the slide showed. Nothing moves to the notes and the
 * form never changes: a slide that still fails is kept and flagged.
 */

export type Written = Record<string, unknown>;

export type Rendered = { spec: SlideSpec; variant?: string; structure: SlideStructure };

export type FitResult =
  | { ok: true }
  | {
      ok: false;
      /** The writer field the failure is attributed to. */
      field: string;
      /** What the slide showed, in plain words, with the themes it happened on. */
      failure: string;
      /** Themes that fail at all. */
      themes: string[];
    };

const SET_KIND: Record<
  SetForm,
  { kind: "starter" | "instructions" | "exit-ticket"; heading: string }
> = {
  "starter-set": { kind: "starter", heading: "Do now" },
  "check-set": { kind: "starter", heading: "Quick check" },
  "exit-ticket": { kind: "exit-ticket", heading: "Exit ticket" },
};

/**
 * The tag a set slide's class sees when its slide kind's own tag would mislabel it: a mid-lesson
 * check is drawn as a starter list but is a check, not a starter.
 */
export const SET_TAG: Partial<Record<SetForm, string>> = { "check-set": "CHECK" };

/** A check-set the plan gave the practise role is pupils' practice, headed and tagged so. */
const isPractice = (form: string, role: string | undefined) =>
  form === "check-set" && role === "practise";

/** A set slide with its kind tag relabelled for the form (see `SET_TAG`); others unchanged. */
export function withSetTag(slide: Slide, form: string, role?: string): Slide {
  const label = isPractice(form, role) ? "PRACTICE" : isSetForm(form) ? SET_TAG[form] : undefined;
  if (!label) return slide;
  return {
    ...slide,
    elements: slide.elements.map((e) =>
      e.name === KIND_TAG_NAME && e.type === "text" ? { ...e, doc: docFromText(label) } : e,
    ),
  };
}

type SetQuestion = { question: string; answer: string };

/**
 * A question set's other list layouts (round S): a set drawn by its `layout` when that names one,
 * else in the kind's default. The closing set moves to one when its items do not fit the default.
 */
export const SET_VARIANTS: ReadonlySet<string> = new Set(["cards", "stepped"]);

const notesOf = (...parts: unknown[]) =>
  parts.filter((p): p is string => typeof p === "string" && p.trim() !== "").join("\n");

/** A question set's spec: the questions listed, the answers as the reveal line and in the notes. */
function setSpec(form: SetForm, out: Written, role?: string): SlideSpec {
  const qs = (out.questions ?? []) as SetQuestion[];
  const { kind } = SET_KIND[form];
  const heading = isPractice(form, role) ? "Practice" : SET_KIND[form].heading;
  const items = qs.map((q) => q.question);
  const answers = qs.map((q) => q.answer);
  const footnote = `Answers: ${answers.map((a, i) => `${i + 1} ${a}`).join("  ·  ")}`;
  const listed = `Answers: ${answers.map((a, i) => `${i + 1}. ${a}`).join(" ")}`;
  const base = { factRefs: [] as string[], heading, footnote, notes: notesOf(out.notes, listed) };
  return (kind === "instructions"
    ? { kind, ...base, steps: items }
    : { kind, ...base, items }) as unknown as SlideSpec;
}

/**
 * A written slide's fields as the slot contract reads them: a diagram slot's spec object is drawn by
 * the diagram renderer, so the slot carries its alt text (never shown as slide text).
 */
export function drawable(form: string, fields: Written): Written {
  const d = fields.diagram;
  if (form !== "diagram-slot" || !d || typeof d !== "object") return fields;
  const alt = (d as { alt?: unknown }).alt;
  return { ...fields, diagram: typeof alt === "string" && alt.trim() ? alt : "Diagram" };
}

/** The slide spec a written slide makes, with its variant and structure; notes carried over. */
export function renderWritten(form: string, layout: string, out: Written, role?: string): Rendered {
  if (isSetForm(form))
    return {
      spec: setSpec(form, out, role),
      ...(SET_VARIANTS.has(layout) ? { variant: layout } : {}),
      structure: {},
    };
  const { notes, ...fields } = out;
  const made = specOfWriter(form as PaletteFormId, drawable(form, fields), layout);
  if (!made) throw new Error(`plan-write: ${form} is not drawn on a slide`);
  const spec = { ...made.spec, notes: notesOf((made.spec as { notes?: string }).notes, notes) };
  return {
    spec: spec as SlideSpec,
    ...(made.variant ? { variant: made.variant } : {}),
    // A practise slide is a teaching kind (a list) tagged PRACTICE; the look makes room for the tag.
    // Its items step up and the notes answer them by number, so its list is numbered (spike/fmt).
    structure:
      role === "practise" ? { ...made.structure, tag: "PRACTICE", ordered: true } : made.structure,
  };
}

const FIT_META: MaterialiseMeta = {
  promptVersion: "fit",
  model: "code",
  at: "1970-01-01T00:00:00.000Z",
};

/** One theme's failure line (`"<theme>: <why>"`) as the field it names and plain words. */
export function attribute(
  line: string,
  form: string,
  layout: string,
  out: Written,
): { theme: string; field: string; what: string } {
  const at = line.indexOf(": ");
  const theme = line.slice(0, at);
  const why = line.slice(at + 2);
  const parts = isSetForm(form)
    ? "questions"
    : (partsField(slotContract(form as PaletteFormId, layout)) ?? "body");
  const heading = /^heading on (\d+) lines/.exec(why);
  if (heading)
    return { theme, field: "heading", what: `the heading sits on ${heading[1]} lines, not one` };
  const reason = /^reason on (\d+) lines, the panel keeps (\d+)/.exec(why);
  if (reason) {
    return {
      theme,
      field: "explanation",
      what: `the explanation takes ${reason[1]} lines where its panel shows ${reason[2]}`,
    };
  }
  const lost = /^not kept "(.*)$/.exec(why);
  if (lost) {
    const start = (lost[1] ?? "").replace(/"$/, "");
    const field =
      Object.keys(out).find((k) => k !== "notes" && JSON.stringify(out[k]).includes(start)) ??
      parts;
    return { theme, field, what: `"${start}…" is not shown on the slide` };
  }
  const placed = /^no (.+)$/.exec(why);
  if (placed) return { theme, field: parts, what: `the ${placed[1]} cannot be placed` };
  const said: string[] = [];
  if (why.includes("overflow")) said.push("the text runs past the slide's safe area");
  if (why.includes("overlap")) said.push("text overlaps other parts of the slide");
  if (why.includes("Why? lane")) {
    return { theme, field: "options", what: "the options run into the reveal panel's space" };
  }
  if (why.includes("stepped down")) said.push("the text has to be set below body size to fit");
  if (why.includes("answers cover")) said.push("the revealed answers cover the questions");
  return { theme, field: parts, what: said.join("; ") || why };
}

/**
 * A question set's failing themes, judged with its answers revealed, at body size (stepDown 0) as
 * every other slide is: the reveal no longer leaves the list stepped down (structure.ts).
 */
function setFailing({ spec, variant }: Rendered): string[] {
  return THEMES.filter(
    (theme) =>
      !slideFits(
        withAnswersReveal(materialiseSlide(spec, theme.id, FIT_META, undefined, variant), theme.id),
        theme,
        0,
      ).ok,
  ).map((t) => `${t.id}: overflow`);
}

/**
 * A diagram slot whose spec draws is laid out again around the drawing (`withDiagramDrawn`): the
 * words move to the other column with the drawing's own box, so the slot's measure alone can pass a
 * body that overruns once drawn (E1 y4 s4 on chalk, crayon and beacon). Each theme's drawn slide is
 * judged at body size, as the class sees it.
 */
function drawnFailing(form: string, layout: string, out: Written): string[] {
  const spec = out.diagram;
  if (form !== "diagram-slot" || !spec || typeof spec !== "object") return [];
  const r = renderWritten(form, layout, out);
  return THEMES.flatMap((theme) => {
    const slide = materialiseSlide(r.spec, theme.id, FIT_META, undefined, r.variant, r.structure);
    const drawn = withDiagramDrawn(slide, theme, spec);
    if (drawn === slide) return [];
    const f = slideFits(drawn, theme, 0);
    if (f.ok) return [];
    const why = [
      ...(f.overflow.length > 0 ? ["overflow"] : []),
      ...(f.overlaps > 0 ? ["overlap"] : []),
    ];
    return [`${theme.id}: ${why.join(", ") || "overflow"}`];
  });
}

/** `headingAsIs`: a heading that wraps is taken as it is, at its measured height (round J). */
type FitOptions = { headingAsIs?: boolean };

const HEADING_WRAP = /^heading on \d+ lines/;

function failingLines(form: string, layout: string, out: Written, opts: FitOptions = {}): string[] {
  if (opts.headingAsIs) {
    return failingLines(form, layout, out).filter(
      (l) => !HEADING_WRAP.test(l.slice(l.indexOf(": ") + 2)),
    );
  }
  if (isSetForm(form)) return setFailing(renderWritten(form, layout, out));
  const { notes: _notes, ...fields } = out;
  const lines = contractFits(
    slotContract(form as PaletteFormId, layout),
    drawable(form, fields),
  ).failing;
  const seen = new Set(lines.map((l) => l.slice(0, l.indexOf(": "))));
  // One line per theme: a theme the slot measure already fails keeps its own reasons.
  return [
    ...lines,
    ...drawnFailing(form, layout, out).filter((l) => !seen.has(l.split(": ")[0] ?? "")),
  ];
}

/** A probe value: every text cut to its first two words (measured only, never saved). */
function probeValue(v: unknown): unknown {
  if (typeof v === "string") return v.split(/\s+/).slice(0, 2).join(" ");
  if (Array.isArray(v)) return v.map(probeValue);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, typeof x === "string" ? probeValue(x) : x]),
    );
  }
  return v;
}

/**
 * A general failure (overflow, overlap, a step down) does not name its field. Probe it: the field
 * whose text, cut down in a probe, clears the most themes is the one that breaks the slide, and in
 * a list the item that does. Undefined when no single field clears any theme.
 */
export function locate(
  form: string,
  layout: string,
  out: Written,
  opts: FitOptions = {},
): { field: string; item?: number } | undefined {
  // Each failing theme's reasons ("overflow, overlap, stepped down"), counted, so a probe that
  // lifts one reason on a theme still counts.
  const count = (o: Written) =>
    failingLines(form, layout, o, opts).reduce(
      (n, l) => n + (l.split(": ")[1] ?? "").split(", ").length,
      0,
    );
  let best: { field: string; left: number } | undefined;
  for (const field of Object.keys(out)) {
    if (field === "notes" || out[field] === undefined || out[field] === null) continue;
    const left = count({ ...out, [field]: probeValue(out[field]) });
    if (!best || left < best.left) best = { field, left };
  }
  if (!best) return undefined;
  const failing = count(out);
  if (best.left >= failing) return undefined;
  const value = out[best.field];
  if (!Array.isArray(value) || value.length < 2) return { field: best.field };
  let item: { i: number; left: number } | undefined;
  value.forEach((_, i) => {
    const next = value.map((x, j) => (j === i ? probeValue(x) : x));
    const left = count({ ...out, [best.field]: next });
    if (left < failing && (!item || left < item.left)) item = { i, left };
  });
  return item ? { field: best.field, item: item.i + 1 } : { field: best.field };
}

const GENERAL = /runs past|overlaps|below body size|cover the questions/;

/**
 * Judge a written slide; on failure, the field to re-write and why. With `headingAsIs` a heading
 * that wraps is not itself a failure: the slide is measured with the heading at its actual wrapped
 * height (the look moves everything under it down), and an overflow is the field under it.
 */
export function fitWritten(
  form: string,
  layout: string,
  out: Written,
  opts: FitOptions = {},
): FitResult {
  const lines = failingLines(form, layout, out, opts);
  if (lines.length === 0) return { ok: true };
  const found = lines.map((l) => attribute(l, form, layout, out));
  // A heading on two lines pushes everything under it down: on a theme where it wraps, an overflow
  // is the heading's, and the re-write goes to the heading before the body is touched.
  const wraps = new Map(found.filter((f) => f.field === "heading").map((f) => [f.theme, f]));
  for (const f of found) {
    const h = wraps.get(f.theme);
    if (h && f !== h && GENERAL.test(f.what)) {
      f.field = "heading";
      f.what = `${h.what}, so the text under it runs past the slide's safe area`;
    }
  }
  const general = found.filter((f) => f.field !== "heading" && GENERAL.test(f.what));
  if (general.length > 0) {
    const at = locate(form, layout, out, opts);
    if (at) {
      const under = opts.headingAsIs
        ? "; the heading above it stays on two lines, so it has that much less room"
        : "";
      const where = `${at.item ? `; it is item ${at.item} of ${at.field} that does not fit` : ""}${under}`;
      for (const f of general) {
        f.field = at.field;
        f.what = `${f.what}${where}`;
      }
    }
  }
  // The field named on the most themes; its first description, with those themes.
  const byField = new Map<string, typeof found>();
  for (const f of found) byField.set(f.field, [...(byField.get(f.field) ?? []), f]);
  const [field, hits] = [...byField.entries()].sort((a, b) => b[1].length - a[1].length)[0] as [
    string,
    typeof found,
  ];
  const themes = [...new Set(found.map((f) => f.theme))];
  const on = [...new Set(hits.map((h) => h.theme))];
  const failure = `${hits[0]?.what} on ${on.length} of ${THEMES.length} themes (${on.join(", ")})`;
  return { ok: false, field, failure, themes };
}

export type Rewrite = (field: string, failure: string) => Promise<Written | undefined>;

export type Fitted = {
  out: Written;
  fit: FitResult;
  /** Set when the slide failed at first and a re-write was asked for. */
  rewritten?: { field: string; failure: string; ok: boolean };
};

/**
 * The slide as written when it fits. Otherwise ONE re-write of the field named; nothing is cut
 * after writing (no item, aside or question is dropped). The re-written field is kept when the
 * slide then fits, or fails on no more themes than before; either way a slide that still fails is
 * returned with its failure for the flag.
 */
export async function fitWithRewrite(
  form: string,
  layout: string,
  out: Written,
  rewrite: Rewrite,
): Promise<Fitted> {
  const first = fitWritten(form, layout, out);
  if (first.ok) return { out, fit: first };
  const { field, failure } = first;
  const patch = await rewrite(field, failure).catch(() => undefined);
  if (!patch || !(field in patch))
    return { out, fit: first, rewritten: { field, failure, ok: false } };
  const next = { ...out, [field]: patch[field] };
  const again = fitWritten(form, layout, next);
  if (again.ok) return { out: next, fit: again, rewritten: { field, failure, ok: true } };
  const better = again.themes.length <= first.themes.length;
  let kept = better ? next : out;
  let keptFit: FitResult = better ? again : first;
  let rewritten = { field, failure, ok: false };
  // A second re-write, told what the slide shows now: a heading that still wraps, or the field the
  // first re-write uncovered (the body under a heading now on one line). Any other field keeps its
  // one re-write (a hinge then goes to its re-check, UX ruling 136).
  // lab/cand-fix round 2: a teach body still over after its re-write gets one more, told so (round 1:
  // Freud s4 and rivers-new s6 kept a body that ran into the footer after one failed re-write).
  const bodyAgain = keptFit.field === field && (field === "body" || field === "steps");
  if (!keptFit.ok && (keptFit.field === "heading" || keptFit.field !== field || bodyAgain)) {
    const patch2 = await rewrite(
      keptFit.field,
      bodyAgain
        ? `${keptFit.failure}; it was written again once and still runs over, so say the same in fewer words, keeping its case, its key terms, every step and its point`
        : keptFit.failure,
    ).catch(() => undefined);
    if (patch2 && keptFit.field in patch2) {
      const third = { ...kept, [keptFit.field]: patch2[keptFit.field] };
      const fit3 = fitWritten(form, layout, third);
      if (fit3.ok || fit3.themes.length <= keptFit.themes.length) {
        rewritten = { field: keptFit.field, failure: keptFit.failure, ok: fit3.ok };
        kept = third;
        keptFit = fit3;
      }
    }
  }
  if (keptFit.ok || keptFit.field !== "heading") return { out: kept, fit: keptFit, rewritten };
  // Round J (I1a y9 s4): a heading still on two lines after its re-writes is taken as it is, and
  // the slide is judged at the heading's actual wrapped height (the look moves everything under it
  // down). It fits when nothing under the heading runs past the safe area; otherwise the field
  // under it gets one re-write, told the heading takes the room. Still failing: flagged as before.
  const under = fitWritten(form, layout, kept, { headingAsIs: true });
  if (under.ok) return { out: kept, fit: under, rewritten };
  if (under.field === "heading") return { out: kept, fit: keptFit, rewritten };
  const patch3 = await rewrite(under.field, under.failure).catch(() => undefined);
  if (patch3 && under.field in patch3) {
    const fourth = { ...kept, [under.field]: patch3[under.field] };
    const fit4 = fitWritten(form, layout, fourth, { headingAsIs: true });
    if (fit4.ok) {
      return {
        out: fourth,
        fit: fit4,
        rewritten: { field: under.field, failure: under.failure, ok: true },
      };
    }
  }
  return { out: kept, fit: keptFit, rewritten };
}

const keyText = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * A matching slide's answer key is the pairs themselves: the slide shows every left and every right
 * once and shuffles the right-hand side. So the key must be a permutation of the items shown: each
 * left and each right used exactly once, none empty, and no card on both sides. Anything else marks
 * a wrong match right (or leaves a card that matches nothing). Empty when the key holds.
 */
export function answerKeyFaults(form: string, out: Written): string[] {
  if (form !== "matching") return [];
  const pairs = (Array.isArray(out.pairs) ? out.pairs : []) as {
    left?: unknown;
    right?: unknown;
  }[];
  const lefts = pairs.map((p) => keyText(p.left));
  const rights = pairs.map((p) => keyText(p.right));
  const faults: string[] = [];
  if (lefts.some((l) => !l) || rights.some((r) => !r)) faults.push("a pair has an empty side");
  if (new Set(lefts).size !== lefts.length) faults.push("a left card is used twice");
  if (new Set(rights).size !== rights.length) faults.push("a right card is used twice");
  if (lefts.some((l) => rights.includes(l))) faults.push("a card is on both sides");
  return faults;
}

/** The fields whose units (chunks, steps, points) may move to the notes whole, in order of preference. */
const MOVABLE = ["body", "steps", "points", "questions"];

export type Laddered = {
  form: string;
  layout: string;
  out: Written;
  /** Which rung made it fit: none needed, another layout of the form, the no-picture sibling, units moved. */
  rung: "none" | "layout" | "sibling" | "moved" | "unfit";
  /** Units moved to the notes, word for word. */
  moved: string[];
};

/**
 * lab/cand-fix round 2b: the fit-first fallback after the re-writes, so no slide is saved
 * overflowing. In order: another layout of the same form; the picture form's no-picture sibling (the
 * same heading and body, full width); then whole units of the failing field moved to the notes word
 * for word, from the end (a worked example keeps its last, answer, line), never below the slot's
 * minimum. Nothing is summarised or split. "unfit" when no rung fits (the caller reports it).
 */
export function fitLadder(
  form: string,
  layout: string,
  out: Written,
  sibling?: { form: string; layout: string; of: (o: Written) => Written },
): Laddered {
  const first = fitWritten(form, layout, out);
  if (first.ok) return { form, layout, out, rung: "none", moved: [] };
  if (!isSetForm(form)) {
    for (const c of layoutsOf(form as PaletteFormId)) {
      if (c.layout === layout) continue;
      try {
        if (fitWritten(form, c.layout, out).ok)
          return { form, layout: c.layout, out, rung: "layout", moved: [] };
      } catch {}
    }
  }
  if (sibling) {
    const o2 = sibling.of(out);
    if (fitWritten(sibling.form, sibling.layout, o2).ok)
      return { form: sibling.form, layout: sibling.layout, out: o2, rung: "sibling", moved: [] };
  }
  const tryMove = (f0: string, l0: string, o0: Written): Laddered | undefined => {
    let cur = o0;
    let relaxed = false;
    const moved: string[] = [];
    let fit = fitWritten(f0, l0, cur);
    for (let guard = 0; !fit.ok && guard < 24; guard++) {
      const field = MOVABLE.includes(fit.field)
        ? fit.field
        : MOVABLE.find((m) => Array.isArray(cur[m]));
      const list = field ? cur[field] : undefined;
      if (!field || !Array.isArray(list)) return undefined;
      const min = Math.max(
        1,
        relaxed || isSetForm(f0)
          ? 1
          : (slotContract(f0 as PaletteFormId, l0).slots.find((s) => s.field === field)?.min ?? 1),
      );
      if (list.length <= min) {
        // A worked example at its fewest steps: each step's bracketed reason is a whole unit too,
        // moved to the notes word for word, first step first (round 2b: Freud s9, Tempest s6/s9).
        const k =
          field === "steps"
            ? list.findIndex((t) => typeof t === "string" && /\s\([^()]+\)\s*$/.test(t))
            : -1;
        if (k < 0) {
          // Last rung: below the slot's minimum (a worked example keeps at least its answer line),
          // still whole units word for word, so no slide is saved overflowing.
          if (relaxed) return undefined;
          relaxed = true;
          continue;
        }
        const step = list[k] as string;
        const reason = (step.match(/\(([^()]+)\)\s*$/) ?? [])[1] ?? "";
        moved.push(`${step.replace(/\s*\([^()]+\)\s*$/, "")}: ${reason}`);
        const notes =
          typeof cur.notes === "string" && cur.notes.trim() ? `${cur.notes.trim()}\n` : "";
        cur = {
          ...cur,
          [field]: list.map((t, i) => (i === k ? step.replace(/\s*\([^()]+\)\s*$/, "") : t)),
          notes: `${notes}${step.replace(/\s*\([^()]+\)\s*$/, "")}: ${reason}`,
        };
        fit = fitWritten(f0, l0, cur);
        continue;
      }
      const at = field === "steps" ? list.length - 2 : list.length - 1;
      const unit = list[at];
      const q = unit as { question?: unknown; answer?: unknown };
      const text =
        typeof unit === "string"
          ? unit
          : typeof q?.question === "string"
            ? `${q.question} (${String(q.answer ?? "")})`
            : JSON.stringify(unit);
      moved.unshift(text);
      const notes =
        typeof cur.notes === "string" && cur.notes.trim() ? `${cur.notes.trim()}\n` : "";
      cur = { ...cur, [field]: list.filter((_, i) => i !== at), notes: `${notes}${text}` };
      fit = fitWritten(f0, l0, cur);
    }
    return fit.ok ? { form: f0, layout: l0, out: cur, rung: "moved", moved } : undefined;
  };
  const movedHere = tryMove(form, layout, out);
  if (movedHere) return movedHere;
  if (sibling) {
    const m2 = tryMove(sibling.form, sibling.layout, sibling.of(out));
    if (m2) return m2;
  }
  return { form, layout, out, rung: "unfit", moved: [] };
}
