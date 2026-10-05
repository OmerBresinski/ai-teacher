/**
 * The look check (lab/cand-fix, 5 Oct 2026): after the slides are drawn, each one is rendered as the
 * presenter shows it and a vision model lists what a teacher would fix (prompts/look-check.ts).
 * Only high-confidence flags act, once each: a question item re-asked whole, one field re-asked,
 * a diagram re-asked, or a photo swapped in code. The touched slides are rendered and checked once
 * more; a slide the change made worse goes back to how it was. No loops.
 *
 * This file holds what code decides (the schema, parsing, which action a flag takes) and the
 * orchestration over injected render/check/apply functions, so it is tested without a model or a
 * browser. stages/plan-write.ts supplies the real ones.
 */

import { z } from "zod";

export const LOOK_FAULTS = [
  "picture",
  "question",
  "options",
  "examples",
  "role",
  "readability",
  "pitch",
] as const;
export type LookFault = (typeof LOOK_FAULTS)[number];
export const LOOK_CONFIDENCE = ["high", "medium"] as const;

/** Most flags one slide may raise; the rest are dropped (a long list is a mis-read, not a slide). */
export const LOOK_MAX_FLAGS = 4;
/** Most actions applied to one slide, on different targets. */
export const LOOK_MAX_ACTIONS = 2;

/** Fields that never reach the screen (or reach it only as a picture) and are not shown to the check. */
const OFF_SCREEN = new Set(["notes", "imageBrief", "diagram", "commonsQuery", "photoSubject"]);

/** A written slide's on-screen fields, as the check is shown them. */
export function onScreenFields(out: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(out).filter(
      ([k, v]) => !OFF_SCREEN.has(k) && v !== undefined && v !== null && v !== "",
    ),
  );
}

/** The output schema for one slide: a verdict per fault type, `target` closed to its own fields. */
export function lookCheckSchema(targets: readonly string[]) {
  const all = [...new Set([...targets, "picture"])] as [string, ...string[]];
  const check = z.object({
    seen: z.string(),
    answer: z.enum(["yes", "no", "n/a"]),
    target: z.enum(all),
    confidence: z.enum(LOOK_CONFIDENCE),
    fix: z.string(),
  });
  return z.object({
    looked: z.string(),
    checks: z.object(
      Object.fromEntries(LOOK_FAULTS.map((f) => [f, check])) as Record<LookFault, typeof check>,
    ),
  });
}
export type LookWire = z.infer<ReturnType<typeof lookCheckSchema>>;

/** One flag as stored and logged: the slide's id and number are stamped by code. */
export type LookFlag = {
  slideId: string;
  slide: number;
  fault: LookFault;
  target: string;
  seen: string;
  confidence: "high" | "medium";
  fix: string;
};

/**
 * The model's checklist for one slide as flags: each "yes" that names a target the slide has and
 * carries a fix; at most `LOOK_MAX_FLAGS`, high ones first.
 */
export function parseLookFlags(
  wire: unknown,
  slide: { number: number; slideId: string; targets: readonly string[] },
): LookFlag[] {
  const parsed = z.object({ checks: z.record(z.string(), z.unknown()) }).safeParse(wire);
  if (!parsed.success) return [];
  const allowed = new Set([...slide.targets, "picture"]);
  const one = lookCheckSchema(slide.targets).shape.checks.shape.picture;
  const out: LookFlag[] = [];
  for (const fault of LOOK_FAULTS) {
    const c = one.safeParse(parsed.data.checks[fault]);
    if (!c.success || c.data.answer !== "yes") continue;
    const fix = c.data.fix.trim();
    if (!allowed.has(c.data.target) || fix === "") continue;
    out.push({
      slideId: slide.slideId,
      slide: slide.number,
      fault,
      target: c.data.target,
      seen: c.data.seen.trim(),
      confidence: c.data.confidence,
      fix,
    });
  }
  return out
    .sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === "high" ? -1 : 1))
    .slice(0, LOOK_MAX_FLAGS);
}

/** What one flag does. */
export type LookAction =
  | { kind: "unit"; fields: string[] }
  | { kind: "field"; field: string }
  | { kind: "diagram" }
  | { kind: "photo"; query: string }
  | { kind: "none"; why: string };

/** What the stage knows about a slide when it maps a flag to an action. */
export type LookSlide = {
  index: number;
  slideId: string;
  form: string;
  /** The slide's on-screen field names (the check's targets). */
  fields: string[];
  /** A placed photo (or Commons picture) the code can swap. */
  hasPhoto: boolean;
  /** For a keyed question form: the fields its items live in, re-asked as one unit. */
  itemFields?: string[] | undefined;
};

/** A photo search query from a picture fix: its first words, plain, at most 60 characters. */
export function photoQuery(fix: string): string {
  const words = fix
    .replace(/["“”‘’]/g, "")
    .replace(/[.;:!?].*$/s, "")
    .replace(/^(?:a |an |the )?(?:photo|picture|image|diagram)s? (?:of|showing) /i, "")
    .replace(/^(?:a|an|the) /i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join(" ");
  return words.slice(0, 60).trim();
}

/** The action a flag takes on its slide. Only a high flag acts; the rest are logged. */
export function lookAction(flag: LookFlag, slide: LookSlide): LookAction {
  if (flag.confidence !== "high") return { kind: "none", why: "medium: logged only" };
  if (flag.target === "picture") {
    if (slide.form === "diagram-slot") return { kind: "diagram" };
    if (slide.hasPhoto) {
      const query = photoQuery(flag.fix);
      return query.length >= 3
        ? { kind: "photo", query }
        : { kind: "none", why: "no search words" };
    }
    return { kind: "none", why: "no picture to change" };
  }
  if (
    (flag.fault === "question" || flag.fault === "options") &&
    slide.itemFields &&
    slide.itemFields.includes(flag.target)
  )
    return { kind: "unit", fields: slide.itemFields };
  if (slide.fields.includes(flag.target)) return { kind: "field", field: flag.target };
  return { kind: "none", why: "target not on the slide" };
}

const FAULT_WORDS: Record<LookFault, string> = {
  picture: "the picture does not match the text",
  question: "the question is vague or has more than one defensible answer",
  options: "an option does not fit its stem",
  examples: "the examples set side by side do not belong together",
  role: "the content does not do what the slide's label says",
  readability: "it is hard to read on the projected slide",
  pitch: "it is pitched wrongly for this year group",
};

/** The re-ask's failure line: what the look check saw and the one change it asks for. */
export function lookFailure(flag: LookFlag): string {
  const seen = flag.seen.replace(/[.\s]+$/, "");
  return `Seen on the rendered slide: ${seen}, so ${FAULT_WORDS[flag.fault]}. Change: ${flag.fix.replace(/[.\s]+$/, "")}. Keep everything else on the slide as it is`;
}

/** One logged look-check event. */
export type LookLog = LookFlag & {
  pass: 1 | 2;
  action: LookAction["kind"];
  outcome: string;
};

export type LookReport = {
  checked: number;
  flagged: { high: number; medium: number };
  byFault: Partial<Record<LookFault, number>>;
  slidesFlaggedHigh: number;
  applied: number;
  slidesFixed: number;
  recheckPassed: number;
  reverted: number;
  checkErrors: number;
  renderMs: number;
  checkMs: number;
  totalMs: number;
  /** The check calls alone (set by the caller): count, tokens and cost; re-asks are not in it. */
  checkCalls?: { calls: number; inputTokens: number; outputTokens: number; costUsd: number };
};

export type LookIO = {
  slides: () => LookSlide[];
  /** Data URLs of the slides at these indices, as the presenter shows them now. */
  render: (indices: number[]) => Promise<Map<number, string>>;
  /** The flags for one slide (throws on a failed call). */
  check: (slide: LookSlide, image: string) => Promise<LookFlag[]>;
  /** Carry out one action; true when the slide changed. */
  apply: (
    slide: LookSlide,
    action: Exclude<LookAction, { kind: "none" }>,
    flag: LookFlag,
  ) => Promise<boolean>;
  snapshot: (index: number) => unknown;
  restore: (index: number, snap: unknown) => Promise<void>;
  log: (entry: LookLog) => void;
  now?: () => number;
};

/** The look-check stage: render, check, act on high flags once, re-render and re-check once. */
export async function runLookCheck(io: LookIO): Promise<LookReport> {
  const now = io.now ?? Date.now;
  const t0 = now();
  let renderMs = 0;
  let checkMs = 0;
  const report: LookReport = {
    checked: 0,
    flagged: { high: 0, medium: 0 },
    byFault: {},
    slidesFlaggedHigh: 0,
    applied: 0,
    slidesFixed: 0,
    recheckPassed: 0,
    reverted: 0,
    checkErrors: 0,
    renderMs: 0,
    checkMs: 0,
    totalMs: 0,
  };
  const checkAll = async (slides: LookSlide[]) => {
    const r0 = now();
    const images = await io.render(slides.map((s) => s.index));
    renderMs += now() - r0;
    const c0 = now();
    const got = await Promise.all(
      slides.map(async (s) => {
        const image = images.get(s.index);
        if (!image) return [s, undefined] as const;
        try {
          return [s, await io.check(s, image)] as const;
        } catch {
          report.checkErrors += 1;
          return [s, undefined] as const;
        }
      }),
    );
    checkMs += now() - c0;
    return got;
  };

  const first = await checkAll(io.slides());
  const touched: { slide: LookSlide; snap: unknown; acted: LookFlag[]; highBefore: number }[] = [];
  for (const [slide, flags] of first) {
    if (!flags) continue;
    report.checked += 1;
    const high = flags.filter((f) => f.confidence === "high");
    report.flagged.high += high.length;
    report.flagged.medium += flags.length - high.length;
    for (const f of flags) report.byFault[f.fault] = (report.byFault[f.fault] ?? 0) + 1;
    if (high.length > 0) report.slidesFlaggedHigh += 1;
    let snap: unknown;
    const acted: LookFlag[] = [];
    const targets = new Set<string>();
    for (const f of flags) {
      const action = lookAction(f, slide);
      if (action.kind === "none") {
        io.log({ ...f, pass: 1, action: "none", outcome: action.why });
        continue;
      }
      const target =
        action.kind === "unit"
          ? action.fields.join(",")
          : action.kind === "field"
            ? action.field
            : "picture";
      if (acted.length >= LOOK_MAX_ACTIONS || targets.has(target)) {
        io.log({
          ...f,
          pass: 1,
          action: action.kind,
          outcome: "skipped: slide already changed there",
        });
        continue;
      }
      if (snap === undefined) snap = io.snapshot(slide.index);
      const ok = await io.apply(slide, action, f).catch(() => false);
      io.log({
        ...f,
        pass: 1,
        action: action.kind,
        outcome: ok ? "applied" : "not applied (re-ask failed or did not fit)",
      });
      if (ok) {
        report.applied += 1;
        acted.push(f);
        targets.add(target);
      }
    }
    if (acted.length > 0) touched.push({ slide, snap, acted, highBefore: high.length });
  }
  report.slidesFixed = touched.length;

  if (touched.length > 0) {
    const current = new Map(io.slides().map((s) => [s.index, s]));
    const again = await checkAll(touched.map((t) => current.get(t.slide.index) ?? t.slide));
    for (const [slide, flags] of again) {
      const t = touched.find((x) => x.slide.index === slide.index);
      if (!t) continue;
      if (!flags) {
        for (const f of t.acted)
          io.log({ ...f, pass: 2, action: "none", outcome: "re-check failed; change kept" });
        continue;
      }
      const high = flags.filter((f) => f.confidence === "high");
      const recurs = (f: LookFlag) => high.some((h) => h.fault === f.fault);
      const worse = high.length > t.highBefore;
      const passed = !t.acted.some(recurs);
      if (passed && !worse) report.recheckPassed += 1;
      if (worse) {
        await io.restore(slide.index, t.snap);
        report.reverted += 1;
      }
      for (const f of t.acted)
        io.log({
          ...f,
          pass: 2,
          action: "none",
          outcome: worse
            ? `reverted: re-check found ${high.length} high flags, before ${t.highBefore}`
            : recurs(f)
              ? "still flagged on re-check; change kept"
              : "passed re-check",
        });
      for (const h of high.filter((x) => !t.acted.some((a) => a.fault === x.fault)))
        io.log({
          ...h,
          pass: 2,
          action: "none",
          outcome: "new or remaining flag on re-check; logged only",
        });
    }
  }
  report.renderMs = renderMs;
  report.checkMs = checkMs;
  report.totalMs = now() - t0;
  return report;
}
