/*
 * TEACH-247 part cj (Greg, 1 Nov 2026): a check slide may show the picture of the thing its
 * question works from. The writer declines its optional picture on check slides 59 of 61 times, so
 * after the writer, code gives each practice, hinge and exit ticket that has no visual
 * the visual an earlier teaching slide showed for the same objective (the flow's `teaches`).
 *
 * - The source: an earlier slide that is not a check, teaches an objective the check slide checks,
 *   and whose picture or diagram landed (a photo or a drawing; a pending or failed one is no
 *   source) and shares a telling word with the questions or their right answers (never a hinge's
 *   wrong options; a word at most half the deck's teaching visuals name). The one sharing the
 *   most telling words wins, then the most words, then the nearer one.
 * - The answer-leak guard (audit, 2 Nov 2026): a labelled diagram is always reused lettered (where
 *   a label sits can answer), and not at all when it has no lettered form. A photo cannot be
 *   lettered: an answer word in its own request, subjects, alt or credits means it shows the
 *   answer, and it is not reused; one that passes is lent with a neutral alt. Not reused: logged.
 * - The fit: the visual is placed only when the writer's words still fit beside it no worse than
 *   without it (`fits`); code never cuts a word or changes the layout to make room.
 * - Every check slide left without a visual is a logged skip with its reason: `no-source`, `leak`
 *   or `fit`. Nothing is dropped silently.
 *
 * Amended 12 Nov 2026 (blind review of 11 Nov, CRITIQUE-1 items 2 and 3): nothing is lent any
 * more. A visual is never shown on a second slide to fill a slot, so a source found is logged as a
 * `repeat` skip, and one whose numbers are not the questions' (`numberClash`) as `mismatch`. The
 * leak guard and fit test stay for `relend` and for the flow look's own check pictures.
 *
 * A new picture searched for the thing the question names (TEXT-ONLY-DIAG.md Fix 2, route b) is
 * not done here: a slide skipped `no-source` is where it would start.
 */
import { parseDiagram } from "@tj/slides/diagrams";
import { fitsNoWorse } from "./icon-route";
import { type MaterialiseCtx, normalise, pilotFit, type VisualState } from "./materialise";
import { pilotOvers } from "./pilot-fit";

type S = Record<string, unknown>;

/** The check layouts that may borrow a visual (never the quick check: Greg, 1 Nov 2026). */
export const CHECK_TEMPLATES: ReadonlySet<string> = new Set(["practice", "hinge", "exit-ticket"]);

/** The field a check slide's visual sits in: practice's own `picture`, the others' `figure`. */
export const checkSlotKey = (template: string): "picture" | "figure" =>
  template === "practice" ? "picture" : "figure";

export type CheckForm = "as-is" | "letters" | "neutral-alt";
export type CheckSkipReason = "no-source" | "leak" | "fit" | "mismatch" | "repeat";

export type CheckRoute = {
  /** The check slide's index in the deck (0-based). */
  slide: number;
  /** The teaching slide the visual comes from, and the key it sits under there. */
  from: number;
  fromKey: string;
  /** The key it sits under on the check slide. */
  key: "picture" | "figure";
  /** The check slide with the borrowed visual's ask in its field. */
  json: S;
  /** The visual's state on the check slide (the source's, or its leak-safe form). */
  state: VisualState;
  form: CheckForm;
};
export type CheckSkip = {
  slide: number;
  template: string;
  reason: CheckSkipReason;
  why: string;
};

/** The neutral alt a photo takes when its own would name an answer. */
export const NEUTRAL_ALT = "A picture to work from for the questions on this slide.";

const str = (v: unknown) => (typeof v === "string" ? v : "");
const isObj = (v: unknown): v is S => !!v && typeof v === "object" && !Array.isArray(v);
const isVisual = (v: unknown): v is S => isObj(v) && ("shows" in v || "kind" in v);

const STOP = new Set(
  (
    "a an and are as at be by can could did do does for from had has have how in into is it its " +
    "of on or that the their them then there these they this those to was were what when where " +
    "which who why will with would you your one two three not no yes about after before more " +
    "most some any all each other than so very just also our we he she his her him"
  ).split(" "),
);
/**
 * A word's rough stem, the same for its forms: "leaves" and "leaf", "carries" and "carry",
 * "houses" and "house", "passing" and "pass" each meet.
 */
export const stem = (w0: string): string => {
  let w = w0.toLowerCase();
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && w.endsWith("ves")) w = `${w.slice(0, -3)}f`;
  else if (w.length > 4 && /(ches|shes|sses|xes)$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
};
/** The content words of a text, stemmed. */
export const terms = (text: string): string[] =>
  (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !STOP.has(w)).map(stem);

const NUMBER_WORDS: Record<string, number> = Object.fromEntries(
  (
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen " +
    "fifteen sixteen seventeen eighteen nineteen twenty"
  )
    .split(" ")
    .map((w, n) => [w, n] as const),
);
const TENS: Record<string, number> = {
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
};

/** The whole numbers a text names, as digits or as words ("twelve", "4", "1/4" gives 1 and 4). */
export function numbersIn(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.toLowerCase().matchAll(/\d+(?:\.\d+)?|[a-z]+/g)) {
    const w = m[0];
    if (/^\d/.test(w)) out.add(Number(w));
    else if (w in NUMBER_WORDS) out.add(NUMBER_WORDS[w] as number);
    else if (w in TENS) out.add(TENS[w] as number);
  }
  return out;
}

/**
 * Why a visual's numbers are not the question's, or undefined when they agree: both name numbers
 * ("twelve counters in four groups", "1/4 of 28") and at least one of the visual's is nowhere in
 * the check slide's questions or right answers. A visual or a question with no numbers (past 1)
 * never clashes.
 */
export function numberClash(visual: string, question: string): string | undefined {
  // "One" is as often a word as a number ("one flower", "which one"): 0 and 1 never clash.
  const shown = new Set([...numbersIn(visual)].filter((n) => n > 1));
  if (!shown.size) return undefined;
  // A question with no numbers makes no claim a number could contradict ("a fire in 1666" beside
  // "How did people pass water?").
  const asked = numbersIn(question);
  if (![...asked].some((n) => n > 1)) return undefined;
  const other = [...shown].filter((n) => !asked.has(n));
  return other.length
    ? `the visual shows ${other.join(", ")}, which the questions never use`
    : undefined;
}

/** The question and answer pairs a check slide asks. */
export function checkPairs(s: S): { question: string; answer: string }[] {
  if (s.template === "hinge") {
    const opts = Array.isArray(s.options) ? s.options : [];
    const k = Number(s.correct ?? 1);
    const right = opts[Number.isInteger(k) && k >= 1 && k <= opts.length ? k - 1 : 0];
    const answer = isObj(right) ? str(right.text) : str(right);
    return [{ question: str(s.stem) || str(s.heading), answer }];
  }
  const items = Array.isArray(s.items) ? s.items : [];
  if (items.length)
    return items.map((i) =>
      isObj(i)
        ? { question: str(i.question), answer: str(i.answer) }
        : { question: str(i), answer: "" },
    );
  // TEACH-247 part cw (review): the other shape materialise reads (`quickAnswers`): `questions`
  // with an `answers` list by the same index. Read as items saw no answer at all there.
  const qs = Array.isArray(s.questions) ? s.questions : [];
  const as = Array.isArray(s.answers) ? s.answers : [];
  return qs.map((q, k) => ({
    question: isObj(q) ? str(q.question) : str(q),
    answer: isObj(as[k]) ? str((as[k] as S).answer) : str(as[k]),
  }));
}

/**
 * The words a source is matched on: the heading, the questions and their right answers. A hinge's
 * wrong options are left out: a picture of a distractor would point pupils at it.
 */
const checkWords = (s: S): string =>
  [str(s.heading), str(s.stem), ...checkPairs(s).flatMap((p) => [p.question, p.answer])].join(" ");

/** The slide already carries a visual: its own picture or figure, or a full row of option icons. */
export function hasVisual(s: S): boolean {
  if (isVisual(s.picture) || isVisual(s.figure) || isVisual(s.diagram)) return true;
  if (s.template !== "hinge") return false;
  const opts = Array.isArray(s.options) ? s.options : [];
  return (
    opts.length > 0 &&
    opts.every(
      (o) => isObj(o) && ((typeof o.icon === "string" && !!o.icon.trim()) || isVisual(o.picture)),
    )
  );
}

/** A teaching slide's visuals, by the key the stage asked them under (as `materialise` keys them). */
export function sourceVisuals(raw: S): { key: string; ask: S }[] {
  const s = normalise(raw);
  const out: { key: string; ask: S }[] = [];
  for (const k of ["picture", "diagram", "figure"])
    if (isVisual(s[k])) out.push({ key: k, ask: s[k] as S });
  const panel = isObj(s.panel) ? s.panel : null;
  if (s.template === "panel-list" && panel && isVisual(panel.picture))
    out.push({ key: "panel", ask: panel.picture as S });
  if (s.template === "myth") {
    const m = (isObj(s.myth) ? s.myth : s) as S;
    const p = isObj(m.proof) ? m.proof : null;
    if (p && isVisual(p.picture)) out.push({ key: "proof", ask: p.picture as S });
  }
  return out;
}

/** A spec's ids and settings, never drawn as words (a label's `part` is where it points). */
const STRUCTURAL = new Set(["kind", "view", "part", "anchor", "id", "style", "subject"]);
/** Every string a value holds (a diagram spec's labels, title, nodes, alt), data URLs aside. */
function stringsIn(v: unknown, out: string[] = []): string[] {
  if (typeof v === "number") out.push(String(v));
  else if (typeof v === "string") {
    if (v.startsWith("data:image/svg")) out.push(...svgTexts(v));
    else if (!v.startsWith("data:") && !/^(https?:)?\//.test(v)) out.push(v);
  } else if (Array.isArray(v)) for (const x of v) stringsIn(x, out);
  else if (isObj(v))
    for (const [k, x] of Object.entries(v)) if (!STRUCTURAL.has(k)) stringsIn(x, out);
  return out;
}
/** The words an SVG drawing writes on itself (`<text>`), so a drawn model's labels are read too. */
function svgTexts(src: string): string[] {
  // Decoded without throwing: base64 through Buffer, %XX escapes one by one (a malformed escape stays).
  const body = src.slice(src.indexOf(",") + 1);
  const svg = /;base64,/.test(src.slice(0, 60))
    ? Buffer.from(body, "base64").toString("utf8")
    : body.replace(/%([0-9a-f]{2})/gi, (_, h: string) =>
        String.fromCharCode(Number.parseInt(h, 16)),
      );
  return [...svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) =>
    (m[1] ?? "").replace(/<[^>]+>/g, " "),
  );
}

/** The words a visual state puts in front of pupils (or a screen reader): what could leak. */
export function visibleText(st: VisualState): string {
  // A photo's alt, request, subjects, note and credits: any of them may reach a screen or a reader.
  if (st.status === "photo") return stringsIn({ ...st.photo, src: "" }).join(" ");
  if (st.status === "diagram") return stringsIn(st.spec).join(" ");
  return "";
}

/**
 * Why the visual would give an answer away, or undefined when it does not. Every question counts,
 * not only naming ones, and one telling answer word is enough: a word of the answer the question
 * does not already say, found anywhere in the visual's text. A false skip costs a picture; a leak
 * costs the question.
 */
export function leakOf(s: S, visible: string): string | undefined {
  const seen = new Set(terms(visible));
  if (!seen.size) return undefined;
  for (const p of checkPairs(s)) {
    const asked = new Set(terms(p.question));
    const hit = terms(p.answer).filter((w) => !asked.has(w) && seen.has(w));
    if (hit.length)
      return `"${p.question}" is answered by the visual ("${p.answer}": ${[...new Set(hit)].join(", ")})`;
  }
  return undefined;
}

/*
 * TEACH-247 part cw (CODE-NOTE v4.21 item 2): a picture or diagram the writer chose for a check
 * slide (written on the slide, or added from its flow look by `withLook`) passes the same answer-
 * leak test a lent one does. Its request is all there is when the slide closes (the photo lands
 * after editable), so the request is what is read: an answer word in it means the picture is
 * searched for, or drawn, as the answer. A leaking pick is never asked for: it is dropped and
 * logged (`check-look-leak`), and the slide goes on to cj (`borrowForChecks`), which lends a
 * leak-safe teaching visual or logs its own skip. A quick check never borrows: it ships text-only.
 */
/** The check layouts whose own picture is screened: cj's, and the quick check (its figure draws). */
export const PICK_TEMPLATES: ReadonlySet<string> = new Set([...CHECK_TEMPLATES, "question-set"]);

/**
 * The words a visual ask sends to the picture search or the drawer, and so may put on screen: its
 * request (`shows`, `must_see`), labels, title and alt. Not `ask` / `ask_without`, which are the
 * slide's own lines (a leak in them is the slide's words, not its picture).
 */
export function askWords(ask: S): string {
  const { ask: _a, ask_without: _w, ...rest } = ask;
  return stringsIn(rest).join(" ");
}

export type PickLeak = {
  key: "picture" | "figure" | "diagram";
  /**
   * `look`: added from the flow's look at close; `writer`: on the slide as the writer wrote it;
   * `repair`: on a repair's rewrite of the slide.
   */
  origin: "writer" | "look" | "repair";
  why: string;
};

/**
 * A check slide with every visual the writer chose whose request names an answer taken off (the
 * key set to null, as the schema's "no picture"), and each one taken off. A lent visual is cj's
 * and already screened; any other slide is returned as it is.
 */
export function dropLeakingPicks(
  s: S,
  /** The key `withLook` filled from the flow's look, if any. */
  looked?: string,
  /** The slide is a repair's rewrite. */
  repair = false,
): { slide: S; dropped: PickLeak[] } {
  if (!PICK_TEMPLATES.has(str(s.template))) return { slide: s, dropped: [] };
  let out = s;
  const dropped: PickLeak[] = [];
  for (const key of ["picture", "figure", "diagram"] as const) {
    const ask = s[key];
    if (!isVisual(ask) || ask.lent === true) continue;
    const leak = leakOf(s, askWords(ask));
    if (!leak) continue;
    out = { ...out, [key]: null };
    dropped.push({
      key,
      origin: repair ? "repair" : key === looked ? "look" : "writer",
      why: leak,
    });
  }
  return { slide: out, dropped };
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/**
 * A diagram spec with letters in place of its labels' words, its title and alt neutral: the same
 * model, the answer kept back. Undefined when the spec has no labels to letter.
 */
export function letteredSpec(spec: unknown): S | undefined {
  if (!isObj(spec) || !Array.isArray(spec.labels) || !spec.labels.length) return undefined;
  if ("drawn" in spec) return undefined;
  const copy = structuredClone(spec) as S;
  const labels = (copy.labels as unknown[]).map((l, k) =>
    isObj(l) ? { ...l, text: LETTERS[k] ?? String(k + 1) } : (LETTERS[k] ?? String(k + 1)),
  );
  // No title at all (a null one does not parse: rivers r1's lettered meander was dropped as
  // "the spec does not parse" and the exit ticket shipped without it).
  const { title: _t, ...rest } = copy;
  const out = { ...rest, labels, alt: "A diagram with lettered parts." };
  // A spec that drew must still draw lettered; one the drawer cannot parse has no lettered form.
  return parseDiagram(spec) && !parseDiagram(out) ? undefined : out;
}

/** The ask fields that carry words or re-ask: never copied onto a check slide. */
const NOT_LENT = new Set(["ask", "ask_without", "labels", "must_see"]);
/**
 * The check slide's own copy of a source's ask: marked `lent` (the layouts draw it in their card),
 * without the fields that would join the slide's instruction or stem or name the answer.
 */
export function lentAsk(ask: S): S {
  const out: S = { lent: true };
  for (const [k, v] of Object.entries(ask)) if (!NOT_LENT.has(k)) out[k] = structuredClone(v);
  return out;
}

/** The leak-safe form of a source's visual for a check slide, or why there is none. */
export function safeForm(
  s: S,
  st: VisualState,
): { state: VisualState; form: CheckForm } | { leak: string } {
  // Never the source's own object: the check slide's copy is its own (a later change to either
  // slide's state never reaches the other).
  const own = structuredClone(st);
  if (own.status === "diagram") {
    // A labelled diagram on a check slide is always lettered (audit, 2 Nov 2026): where a label
    // sits can answer a question whose answer shares no word with it (rivers r1: "River cliff" on
    // the outer bank answers "which bank?", answer "outer"). No lettered form: not reused.
    const labelled = isObj(own.spec) && Array.isArray(own.spec.labels) && own.spec.labels.length;
    if (labelled) {
      const lettered = letteredSpec(own.spec);
      if (!lettered) return { leak: "its labels cannot be swapped for letters" };
      const again = leakOf(s, stringsIn(lettered).join(" "));
      if (again) return { leak: `${again}, with letters in place of the labels` };
      return { state: { status: "diagram", spec: lettered }, form: "letters" };
    }
  }
  // A photo cannot be lettered: an answer word in its own request, subjects, alt or credits means
  // the photo shows the answer (plants r1: a roots photo beside "Which part takes in water?"), so
  // it is not reused. Neutral words would hide that from a reader, not from the pupils' eyes.
  const leak = leakOf(s, visibleText(own));
  if (leak) return { leak };
  if (own.status === "photo") {
    const { subjects: _s, about: _a, ...photo } = own.photo;
    return {
      state: { status: "photo", photo: { ...photo, alt: NEUTRAL_ALT, request: NEUTRAL_ALT } },
      form: "neutral-alt",
    };
  }
  return { state: own, form: "as-is" };
}

/**
 * Whether the check slide holds its words beside the visual no worse than without it: no field
 * further past its room, nothing clipped, no new layout overflow (a count, a question that does
 * not fit). Measured at the drawn size, as the pilot fit measures (`pilotOvers`).
 */
export function fitsWithVisual(
  before: S,
  after: S,
  ctx: MaterialiseCtx,
  key: string,
  state: VisualState,
): boolean {
  const withIt: MaterialiseCtx = { ...ctx, visual: (k) => (k === key ? state : ctx.visual(k)) };
  if (!fitsNoWorse(pilotOvers(before, ctx), pilotOvers(after, withIt))) return false;
  const was = new Set(pilotFit(before, ctx).over);
  return pilotFit(after, withIt).over.every((o) => was.has(o));
}

export type BorrowArgs = {
  slides: readonly (S | undefined)[];
  /** The objectives slide i teaches or checks (its flow entry's `teaches`). */
  teaches: (i: number) => readonly number[];
  /** Slide i's visual states, by key. */
  state: (i: number) => (key: string) => VisualState;
  /** The check slide `next` (slide i with the visual) still fits with `state` under `key`. */
  fits: (i: number, next: S, key: string, state: VisualState) => boolean;
  /** Only these slides (a re-check after a rewrite); every slide by default. */
  only?: ReadonlySet<number>;
};

/** Decides, for every check slide with no visual, which teaching visual it shows or why none. */
export function borrowCheckVisuals(a: BorrowArgs): { routes: CheckRoute[]; skips: CheckSkip[] } {
  const routes: CheckRoute[] = [];
  const skips: CheckSkip[] = [];
  // How many of the deck's teaching visuals name each word: a word most of them share ("people",
  // "house" in Great Fire) says nothing about which one a question works from.
  const askText = (src: S, ask: S) =>
    [str(ask.shows), ...stringsIn(ask.must_see), str(src.heading)].join(" ");
  const df = new Map<string, number>();
  let visuals = 0;
  for (const src of a.slides.slice(2)) {
    if (!src || CHECK_TEMPLATES.has(str(src.template))) continue;
    for (const { ask } of sourceVisuals(src)) {
      visuals += 1;
      for (const w of new Set(terms(askText(src, ask)))) df.set(w, (df.get(w) ?? 0) + 1);
    }
  }
  const telling = (w: string) => (df.get(w) ?? 0) <= Math.max(1, Math.floor(visuals / 2));
  for (const [i, s] of a.slides.entries()) {
    if (i < 2 || !s || (a.only && !a.only.has(i))) continue;
    const template = str(s.template);
    if (!CHECK_TEMPLATES.has(template) || hasVisual(s)) continue;
    const skip = (reason: CheckSkipReason, why: string) =>
      skips.push({ slide: i, template, reason, why });
    const checks = new Set(a.teaches(i));
    if (!checks.size) {
      skip("no-source", "the slide checks no objective");
      continue;
    }
    const words = new Set(terms(checkWords(s)));
    const candidates: {
      from: number;
      key: string;
      ask: S;
      st: VisualState;
      score: number;
      shared: number;
    }[] = [];
    const mismatched: string[] = [];
    for (let j = i - 1; j >= 2; j--) {
      const src = a.slides[j];
      if (!src || CHECK_TEMPLATES.has(str(src.template))) continue;
      if (!a.teaches(j).some((o) => checks.has(o))) continue;
      for (const { key, ask } of sourceVisuals(src)) {
        const st = a.state(j)(key);
        if (st.status !== "photo" && st.status !== "diagram") continue;
        const both = new Set(
          terms(`${askText(src, ask)} ${visibleText(st)}`).filter((w) => words.has(w)),
        );
        const score = [...both].filter(telling).length;
        // A visual that shares no telling word with the questions is not what they work from.
        if (score <= 0) continue;
        // A visual of other numbers (12 counters in 4 groups beside "1/4 of 28") shows a wrong
        // value for the question: never lent (y5 fractions, 11 Nov review).
        const clash = numberClash(`${askText(src, ask)} ${visibleText(st)}`, checkWords(s));
        if (clash) {
          mismatched.push(`slide ${j + 1} ${key}: ${clash}`);
          continue;
        }
        candidates.push({ from: j, key, ask, st, score, shared: both.size });
      }
    }
    if (!candidates.length && mismatched.length) {
      skip("mismatch", mismatched.join("; "));
      continue;
    }
    if (!candidates.length) {
      skip(
        "no-source",
        `no earlier slide on objective ${[...checks].join(", ")} shows a visual its questions name`,
      );
      continue;
    }
    // Most shared words first; the nearer slide on a tie (candidates run nearest first).
    candidates.sort((x, y) => y.score - x.score || y.shared - x.shared);
    // 11 Nov blind review (CRITIQUE-1 item 3): a picture or diagram is never shown on a second slide
    // to fill a slot. The source slide already shows it, so the check slide keeps its no-picture
    // form: an empty slot beats a repeat. A writer who wants a picture on a check slide asks for it
    // in the flow's look (`lookAdded`), which is a new picture, never this one again.
    skip(
      "repeat",
      candidates.map((c) => `slide ${c.from + 1} ${c.key} already shows it`).join("; "),
    );
  }
  return { routes, skips };
}

/** The key a slide's lent visual sits under (`lentAsk`'s mark), if it has one. */
export function lentKey(s: S | undefined): string | undefined {
  if (!s) return undefined;
  return ["picture", "figure"].find((k) => isObj(s[k]) && (s[k] as S).lent === true);
}

/**
 * A repair's rewrite of a check slide that held a lent visual: the visual goes back under the key
 * the rewritten slide's layout reads it from, when its words still fit beside it (`fits`).
 * Undefined when there is nothing to put back (no lent visual, or the rewrite has its own).
 */
export function relend(
  before: S,
  after: S,
  fits: (next: S, key: string) => boolean,
): { slide: S; key: string; was: string } | { skip: string; was: string } | undefined {
  const was = lentKey(before);
  if (!was || hasVisual(after)) return undefined;
  const template = str(after.template);
  if (!CHECK_TEMPLATES.has(template))
    return { skip: `the rewrite made it a ${template || "different"} slide`, was };
  const key = checkSlotKey(template);
  const slide = { ...after, [key]: structuredClone(before[was]) };
  return fits(slide, key)
    ? { slide, key, was }
    : { skip: "the rewritten words do not fit beside the lent visual", was };
}
