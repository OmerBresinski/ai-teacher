// Pure, code-side parts of the bake-off evaluator: slide text as the model sees it, and the objectives matcher.
// No model calls and no imports, so it can be unit-tested and re-run on saved responses at $0.

type Cite = { slide: number; quote: string };
type Pic = { kind: string; alt?: string; labels?: string[]; background?: boolean };
type Q = { text: string; options: string[] };
export type Slide = {
  n: number;
  role: string;
  kind?: string;
  texts: { text: string; name?: string }[];
  questions: Q[];
  pictures: Pic[];
};
export type ObjectiveRow = { id: string; look?: string; taught: Cite[]; checked: Cite[] };

// Fix 1 (9 Oct, base5 rootcause): "/" is stripped too. The model joins a slide's label and text as
// "Cow and calf / A calf is a young cow."; slideText joins them with a newline, so the slash made every
// such quote "unverified".
export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’“”"'`.,;:!?()[\]–—/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const body = (s: Slide) =>
  s.texts
    .filter((t) => !s.questions.some((q) => q.text.endsWith(t.text)))
    .map((t) => t.text.replace(/\n/g, " "));

// The slide's own content apart from its questions and options (prompts list those separately). A picture
// shows as its alt, or its labels when it has no alt. Used by answerable, picture questions and visual fit,
// whose requests (and cached responses) stay as they were.
export const slideText = (s: Slide) =>
  [
    ...body(s),
    ...s.pictures
      .filter((p) => !p.background)
      .map((p) => `[${p.kind}: ${p.alt || (p.labels ?? []).join("; ")}]`),
  ].join("\n");

export const MAX_LABELS = 40;
// Fix 2 (eval v2): what a drawn diagram or table shows, not only its alt. A drawn table's alt is one generic
// sentence ("Sensory register, STM and LTM differ in coding…"), while its cells carry the teaching
// ("Mainly acoustic", "7 ± 2 items"); y12 s4 in base5-1 was judged "names the topic" from the alt alone.
// deck.py puts the SVG title first in labels, so labels equal to the alt are dropped.
export const pictureText = (p: Pic) => {
  const alt = (p.alt ?? "").trim();
  const seen = new Set([norm(alt)]);
  const extra = (p.labels ?? [])
    .map((l) => l.trim())
    .filter((l) => l && !seen.has(norm(l)) && (seen.add(norm(l)), true))
    .slice(0, MAX_LABELS);
  if (!alt) return `[${p.kind}: ${extra.join("; ")}]`;
  return extra.length ? `[${p.kind}: ${alt} Labels: ${extra.join("; ")}]` : `[${p.kind}: ${alt}]`;
};
export const objectivesSlideText = (s: Slide) =>
  [...body(s), ...s.pictures.filter((p) => !p.background).map(pictureText)].join("\n");

// "3, 4, 5, 12", "slides 3-5 and 12", "none" -> slide numbers.
export const lookSlides = (look: string | undefined) => {
  const out = new Set<number>();
  for (const m of (look ?? "").matchAll(/(\d+)\s*(?:[-–—]|to)\s*(\d+)|(\d+)/g)) {
    if (m[3]) out.add(Number(m[3]));
    else for (let i = Number(m[1]); i <= Number(m[2]) && i - Number(m[1]) < 30; i++) out.add(i);
  }
  return [...out];
};

/* ---------- v4 (N1/F1): a slide's role in the objectives job comes from what pupils do on it ---------- */
// deck.py sets `role` from the slide's kind, and the other jobs (answerable, reader, visual fit) keep that role so
// their requests stay byte-identical. The objectives job re-derives it here: a slide is a check ("question") when it
// is a question kind or has options, or when any of its text elements sets pupils a task. base4-3 y1 s10 (diagram)
// "Point from youngest to oldest. Say what changes."; base5-2 y2 s4 (diagram) Caption "Say half or quarter for A
// and B."; polish2-1 y11 s11 Caption "Calculate each mean rate for 0–20 s". Such a slide is then not "teaching",
// so it cannot be cited as taught either (the audit's 5 false "taught" diagram practice slides).
/** The kinds deck.py marks as question slides (eval/deck.py QUESTION_KINDS, unchanged). */
export const QUESTION_KINDS = new Set([
  "multiple-choice",
  "starter",
  "exit-ticket",
  "open-response",
  "check",
  "quiz",
  "practice",
  "retrieval",
  "true-false",
  "questions",
  "mini-whiteboard",
  "hinge",
  "exit",
]);
/**
 * Whether a discussion slide's pupil task counts as a check. Default false, matching the writer's check
 * definition in lab/ab-checkdef a195edc2 (CHECKDEF_TEMPLATES: discussion only teaches). Greg to rule. When
 * true, a discussion slide is a check like any question kind. Changing it changes the objectives requests.
 */
export const DISCUSSION_COUNTS_AS_CHECK = false;
// A sentence that sets pupils a task: an imperative answer cue at its start (after a list marker or "Now"), or a
// question mark at its end. Reading cues are left out on purpose: "Compare how each store codes information…"
// under a table (base5-1 y12 s4) and "Share 10 counters into two equal groups." over a sharing diagram whose points
// give the answer (base5-1 y2 s6) are teaching, as both annotators agreed.
export const TASK_CUE =
  /^(identify|explain|describe|calculate|suggest|predict|find|work out|decide|write|state|name|sort|match|label|draw|discuss|evaluate|justify|tell|say|point|count|complete|choose|circle|show|give|fill|order|put|spot|answer|translate|correct|estimate|classify|shade|colour|color|tick|underline|solve|convert|plot|sketch|talk|try|turn to|agree or disagree|true or false|list|ask)\b/i;
const LEAD_IN =
  /^(?:\d+[.)]|[a-d][.)]|[•\-–]|now,?|then,?|next,?|your turn:?|try it:?|you try:?|on your whiteboard,?)\s*/i;
export const isTaskSentence = (sent: string) => {
  const t = sent.trim().replace(LEAD_IN, "").replace(LEAD_IN, "");
  return TASK_CUE.test(t) || /\?\s*$/.test(t);
};
// Headings, labels and table cells neither set a task nor teach on their own: a heading question is a title
// (base4-3 y8 s5 "Mon ou ma ? / Which one?"), a label names a part.
const NEUTRAL_NAMES =
  /^(heading|title|kind tag|label|key label|callout label|chunk label|card label|side panel label|table cell|table head)$/i;
const sentences = (t: string) => t.split(/(?<=[.?!])\s+|\n+/).filter((x) => x.trim());
/** The slide's first task text when its words are a pupil task: every text element that is not a heading, label or
 * cell opens with a task sentence, and task sentences are more than half of its sentences. A slide that also states
 * content teaches: base5-1 y2 s6 (Lead "Share 10 counters…", Points "Each group has 5 counters."), a2-1 y1 s4
 * ("A calf is a young cow. Point to the cow, then the calf."; R8T y1 s4 likewise), base4-4 y12 s3 (a table captioned "Compare the
 * stores. Which holds the least information?"). A slide whose words are the task is where pupils answer: base5-1 y2
 * s4 ("Is each shaded part one half or one quarter? Explain how you know."). Every element is read (Caption, Point,
 * Lead, Prompt, Text, Item, Step and the rest), not only Lead/Prompt/Text as deck.py does. */
export const pupilTask = (s: Slide) => {
  const els = s.texts.filter((t) => !NEUTRAL_NAMES.test((t.name ?? "").trim()));
  if (!els.length || !els.every((t) => isTaskSentence(sentences(t.text)[0] ?? "")))
    return undefined;
  const all = els.flatMap((t) => sentences(t.text));
  return all.filter(isTaskSentence).length * 2 > all.length ? els[0].text : undefined;
};
export const objectivesRole = (s: Slide): string => {
  if (s.role !== "teach" && s.role !== "question") return s.role;
  if (s.role === "question") return "question"; // a question kind, or options (deck.py)
  if (s.kind === "discussion") return DISCUSSION_COUNTS_AS_CHECK ? "question" : "teach";
  return pupilTask(s) ? "question" : "teach";
};
/** The deck as the objectives job sees it: every slide with its objectives role. */
export const withObjectivesRoles = <D extends { slides: Slide[] }>(d: D): D => ({
  ...d,
  slides: d.slides.map((s) => ({ ...s, role: objectivesRole(s) })),
});

/* ---------- quote matching ---------- */
const toks = (s: string) => norm(s).split(" ").filter(Boolean);
// N3 (base5-1 y8 s3): a table's cells reach the model row by row ("mon père; father; ma mère; mother"), and the
// model quotes one column ("mon père; ma mère"). Each run of labels is also read column-wise for 2 to 6 columns.
export const columnReadings = (cells: string[]) => {
  const out: string[] = [];
  for (let k = 2; k <= 6 && k < cells.length; k++)
    for (let j = 0; j < k; j++) out.push(cells.filter((_, i) => i % k === j).join(" "));
  return out;
};
// F2 (y8 French s6 "Il s'appelle Hugo. (His name is Hugo.) Il a douze ans."): the model drops a gloss in brackets.
export const stripGlosses = (s: string) => s.replace(/\([^()]*\)/g, " ");
const lcs = (a: string[], b: string[]) => {
  const dp = new Array(b.length + 1).fill(0);
  for (const x of a) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = x === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
};
export const FUZZY_MIN = 0.8;
export const FUZZY_MIN_TOKENS = 4;
/** Share of the quote's tokens found in order inside the best window of the text (window = 2 x quote length). */
export const inOrderCoverage = (quote: string, text: string) => {
  const q = toks(quote).slice(0, 12),
    h = toks(text);
  if (!q.length || !h.length) return 0;
  const W = 2 * q.length;
  let best = 0;
  for (let i = 0; i < h.length && best < q.length; i++) {
    if (!q.includes(h[i])) continue;
    best = Math.max(best, lcs(q, h.slice(i, i + W)));
  }
  return best / q.length;
};
/** "exact" (the v1-v3 rule: the quote's first 8 normalised words appear as a run), "fuzzy" (in-order coverage of at
 * least 0.8 over a window, on the text, the text without glosses, or a table read column-wise), or null. */
export const matchQuote = (quote: string, texts: string[], cells: string[][] = []) => {
  const hay = norm(texts.join("\n"));
  if (hay.includes(norm(quote).split(" ").slice(0, 8).join(" "))) return "exact";
  if (toks(quote).length < FUZZY_MIN_TOKENS) return null;
  const variants = [
    texts.join("\n"),
    stripGlosses(texts.join("\n")),
    ...cells.flatMap(columnReadings),
  ];
  return variants.some((v) => inOrderCoverage(quote, v) >= FUZZY_MIN) ? "fuzzy" : null;
};

// The texts a cite may quote: text the model was shown, plus questions and options; and the slide's cell runs
// (diagram labels, table cells) for column-wise reading.
const citeTexts = (s: Slide, text: (s: Slide) => string) => [
  text(s),
  ...s.questions.map((q) => [q.text, ...q.options].join(" ")),
];
const cellRuns = (s: Slide) => [
  ...s.pictures
    .filter((p) => !p.background && (p.labels ?? []).length > 3)
    .map((p) => p.labels ?? []),
  ...(() => {
    const cells = s.texts
      .filter((t) => /^table (cell|head)$/i.test(t.name ?? ""))
      .map((t) => t.text);
    return cells.length > 3 ? [cells] : [];
  })(),
];

// A cite counts when its slide has the right role and its quote matches that slide (matchQuote).
export const verifyCite = (
  slides: Record<number, Slide>,
  c: Cite,
  role: string,
  text = objectivesSlideText,
) => {
  const s = slides[c.slide];
  if (!s || s.role !== role) return false;
  return matchQuote(c.quote, citeTexts(s, text), cellRuns(s)) !== null;
};

// Fault 3 (base5-1 y2 s12): the model listed practice slide 12 in o1's `look` and then cited no check. The
// slide was in the request in full; the output was complete JSON of about 700 tokens against a cap of 8,000;
// the user turn has no slide cap or kind filter beyond teach/question. So it was an omission, not truncation.
// v2 counted such look-only slides; v3 does not (coordinator, 9 Oct: too lenient). A look-only slide would
// count only if it is a question slide AND the model cited it for this objective with a quote that passes the
// same check as any citation, AND the model did not mark it failing; the first two together are already a
// verified check, and the schema has no "fails" field, so nothing extra ever counts. Look-only slides are
// reported in lookOnly (with the reason) for the prompt fix to be measured against; they never score.
// v4 (F5, R7T y12 o1 checked only by starter s3, first teaching slide s4): a check must come after the first
// slide that teaches that objective (its first verified taught slide, else the lesson's first teaching slide).
// Rejected cites go to `early`. A slide may still count for more than one objective (the prompt says so; decided,
// 9 Oct), so "taught" is not de-duplicated across objectives.
export function summariseObjectives(
  d0: { slides: Slide[]; objectives: { id: string; text: string }[] },
  o: { objectives: ObjectiveRow[] },
  opts: { text?: (s: Slide) => string } = {},
) {
  const d = withObjectivesRoles(d0);
  const sl: Record<number, Slide> = Object.fromEntries(d.slides.map((s) => [s.n, s]));
  const text = opts.text ?? objectivesSlideText;
  const firstTeach = Math.min(...d.slides.filter((s) => s.role === "teach").map((s) => s.n));
  return d.objectives.map((ob) => {
    const r = o.objectives.find((x) => x.id === ob.id) ?? {
      id: ob.id,
      look: "",
      taught: [],
      checked: [],
    };
    const ok = (c: Cite, role: string) => verifyCite(sl, c, role, text);
    const taught = [...new Set(r.taught.filter((c) => ok(c, "teach")).map((c) => c.slide))];
    const from = taught.length ? Math.min(...taught) : firstTeach;
    const cited = [...new Set(r.checked.filter((c) => ok(c, "question")).map((c) => c.slide))];
    const checked = cited.filter((n) => n > from);
    const early = cited.filter((n) => n <= from);
    const lookOnly = lookSlides(r.look)
      .filter((n) => sl[n]?.role === "question" && n > from && !cited.includes(n))
      .map((n) => ({
        slide: n,
        reason: r.checked.some((c) => c.slide === n) ? "cite quote failed" : "no cite",
      }));
    return {
      id: ob.id,
      text: ob.text,
      taught,
      checked,
      early,
      lookOnly,
      unverified: [
        ...r.taught.filter((c) => !ok(c, "teach")),
        ...r.checked.filter((c) => !ok(c, "question")),
      ],
    };
  });
}
