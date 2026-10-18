import type { FieldFill } from "./fill";

/*
 * Clipped wording (loop 1b, 18 Oct 2026): does slide text read as natural sentences, or as dense,
 * telegraphic fragments written to fit a cap? Four signals per text field, all heuristics read off
 * the writer's own output (no model call), reported per field kind and per key stage:
 *
 * - `joins`: a ";" or a spaced dash ("—", "–", " - ") inside a short field (CLIPPED_SHORT_FIELD
 *   words or fewer). Maths lines are not exempt: a "working" line's ";" is reported under its kind.
 * - `fragment`: a clause (text split on . ! ? ;) of 2+ words that is not maths, does not open with
 *   a command verb (IMPERATIVES), and holds no verb or auxiliary from VERBS. This is how a dropped
 *   verb or article shows ("Four equal groups"). The lists are short and documented below; they
 *   miss verbs they do not name, so a flagged clause is a candidate, listed in `examples`.
 *   A whole answer of SHORT_ANSWER words or fewer ("8 counters") is a natural short answer, never
 *   a fragment.
 * - `choppy`: two or more consecutive sentences, each under CLIPPED_SHORT_SENTENCE words.
 * - `atCap`: the field's words equal its shown cap exactly (joined from `deckFields` by slide and
 *   path; fields with no cap are left out of that share).
 *
 * The " — " between an answer and its working on an answers slide is drawn by code, not written:
 * `answer` and `working` are scored as the separate fields the writer wrote.
 */

type J = Record<string, unknown>;

/** A field this long or shorter is "short" for the joins signal. */
export const CLIPPED_SHORT_FIELD = 20;
/** A sentence under this many words is short for the choppy signal. */
export const CLIPPED_SHORT_SENTENCE = 5;
/** An answer this short is a short answer, not a clipped sentence. */
export const SHORT_ANSWER = 3;

/** Verbs and auxiliaries that make a clause a sentence (lower case, whole words). */
export const VERBS = new Set(
  (
    "is are was were be been being am has have had do does did can could will would should may " +
    "might must shall isn't aren't don't doesn't can't won't " +
    "make makes made give gives gave show shows showed fit fits take takes took need needs mean " +
    "means get gets got go goes went come comes came share shares shared find finds found split " +
    "splits hold holds held grow grows grew change changes changed live lives lived eat eats ate " +
    "move moves moved happen happens happened use uses used become becomes became stay stays " +
    "look looks looked say says said tell tells told keep keeps kept leave leaves left " +
    "turn turns turned add adds added cut cuts form forms formed cause causes caused " +
    "help helps helped believe believes believed think thinks thought know knows knew " +
    "want wants wanted call calls called work works worked lead leads led rise rises rose " +
    "fall falls fell flow flows flowed make made let lets put puts fill fills filled contain contains"
  ).split(" "),
);

/** Words a command opens with: a clause starting with one is a sentence ("Take one."). */
export const IMPERATIVES = new Set(
  (
    "draw share count take find write explain show sort match complete use look circle name say " +
    "tell compare choose read work halve label colour color mark fill check add take order " +
    "describe list give put think talk discuss decide predict spot point measure solve plan record " +
    "suppose imagine"
  ).split(" "),
);

export type ClipKind =
  | "hinge option"
  | "exit question"
  | "myth lead"
  | "practice task"
  | "answer"
  | "working"
  | "other";

export interface ClipField {
  slide: number;
  path: string;
  kind: ClipKind;
  text: string;
  words: number;
  joins: boolean;
  fragment: boolean;
  choppy: boolean;
  /** Null when the field has no cap to compare with. */
  atCap: boolean | null;
}

const wc = (s: string) => s.split(/\s+/).filter(Boolean).length;
const isMaths = (s: string) => /[=÷×+]/.test(s) || /\d\s*[-−/]\s*\d/.test(s);

export function clipSignals(text: string): Pick<ClipField, "joins" | "fragment" | "choppy"> {
  const t = text.trim();
  const joins = wc(t) <= CLIPPED_SHORT_FIELD && /;|\s[—–-]\s|—|–/.test(t);
  const clauses = t
    .split(/[.!?;]+/)
    .map((c) => c.trim())
    .filter(Boolean);
  const fragment = clauses.some((c) => {
    const ws = c
      .toLowerCase()
      .replace(/[^a-z0-9'\s-]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    if (ws.length < 2 || isMaths(c)) return false;
    if (IMPERATIVES.has(ws[0] ?? "")) return false;
    return !ws.some((w) => VERBS.has(w));
  });
  const sentences = t
    .split(/(?<=[.!?])\s+/)
    .map((s) => wc(s))
    .filter((n) => n > 0);
  let run = 0;
  let choppy = false;
  for (const n of sentences) {
    run = n < CLIPPED_SHORT_SENTENCE ? run + 1 : 0;
    if (run >= 2) choppy = true;
  }
  return { joins, fragment, choppy };
}

const arr = (x: unknown): J[] => (Array.isArray(x) ? (x as J[]) : []);
const str = (x: unknown) => (typeof x === "string" ? x : "");

/** Every scored text field of a writer output, with its kind and signals. */
export function clipFields(writer: J, fills: FieldFill[] = []): ClipField[] {
  const cap = new Map(fills.map((f) => [`${f.slide} ${f.path}`, f]));
  const slides = arr(writer.slides);
  const all: [number, J][] = slides.map((s, i) => [i + 3, s]);
  if (writer.close && typeof writer.close === "object")
    all.push([slides.length + 3, writer.close as J]);
  const out: ClipField[] = [];
  const add = (slide: number, path: string, kind: ClipKind, text: string, capPaths: string[]) => {
    if (!text.trim()) return;
    const f = capPaths.map((p) => cap.get(`${slide} ${p}`)).find(Boolean);
    const signals = clipSignals(text);
    if (kind === "answer" && wc(text) <= SHORT_ANSWER) signals.fragment = false;
    out.push({
      slide,
      path,
      kind,
      text,
      words: wc(text),
      ...signals,
      atCap: f ? f.words === f.cap : null,
    });
  };
  for (const [no, s] of all) {
    const t = str(s.template);
    const points = arr(s.points);
    const myth = points.some((p) => p.kind === "watch-out");
    if (str(s.lead)) add(no, "lead", myth ? "myth lead" : "other", str(s.lead), ["lead"]);
    points.forEach((p, i) => {
      const text = typeof (p as unknown) === "string" ? (p as unknown as string) : str(p.text);
      add(no, `points[${i}]`, "other", text, [`points[${i}].text`, `points[${i}]`]);
    });
    arr(s.options).forEach((o, i) => {
      add(no, `options[${i}]`, "hinge option", str(o.text), [
        `options[${i}]`,
        `options[${i}].text`,
      ]);
    });
    arr(s.items).forEach((it, i) => {
      const q = str(it.question) || str(it.text);
      const kind: ClipKind =
        t === "exit-ticket" ? "exit question" : t === "practice" ? "practice task" : "other";
      add(no, `items[${i}].question`, kind, q, [`items[${i}].question`, `items[${i}].text`]);
      add(no, `items[${i}].answer`, "answer", str(it.answer), [`items[${i}].answer`]);
      add(no, `items[${i}].working`, "working", str(it.working), []);
    });
    arr(s.sides).forEach((x, i) => {
      add(no, `sides[${i}].text`, "other", str(x.text), [`sides[${i}].text`]);
    });
  }
  return out;
}

export interface ClipStats {
  fields: number;
  joinsPct: number;
  fragmentPct: number;
  choppyPct: number;
  /** Share of capped fields written at exactly their shown cap; null when none is capped. */
  atCapPct: number | null;
  capped: number;
}

const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : 0);

export function clipStats(fields: ClipField[]): ClipStats {
  const capped = fields.filter((f) => f.atCap !== null);
  return {
    fields: fields.length,
    joinsPct: pct(fields.filter((f) => f.joins).length, fields.length),
    fragmentPct: pct(fields.filter((f) => f.fragment).length, fields.length),
    choppyPct: pct(fields.filter((f) => f.choppy).length, fields.length),
    atCapPct: capped.length ? pct(capped.filter((f) => f.atCap).length, capped.length) : null,
    capped: capped.length,
  };
}

export interface ClipReport {
  all: ClipStats;
  byKind: Partial<Record<ClipKind, ClipStats>>;
  /** Flagged texts, so a heuristic's false positives can be seen. */
  examples: { slide: number; kind: ClipKind; signals: string[]; text: string }[];
}

export function clipReport(fields: ClipField[]): ClipReport {
  const byKind: Partial<Record<ClipKind, ClipStats>> = {};
  for (const k of new Set(fields.map((f) => f.kind)))
    byKind[k] = clipStats(fields.filter((f) => f.kind === k));
  return {
    all: clipStats(fields),
    byKind,
    examples: fields
      .map((f) => ({
        slide: f.slide,
        kind: f.kind,
        signals: (["joins", "fragment", "choppy"] as const).filter((s) => f[s]),
        text: f.text,
      }))
      .filter((e) => e.signals.length),
  };
}
