// Pure, code-side parts of the bake-off evaluator: slide text as the model sees it, and the objectives matcher.
// No model calls and no imports, so it can be unit-tested and re-run on saved responses at $0.

type Cite = { slide: number; quote: string };
type Pic = { kind: string; alt?: string; labels?: string[]; background?: boolean };
type Q = { text: string; options: string[] };
export type Slide = {
  n: number;
  role: string;
  texts: { text: string }[];
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

// A cite counts when its slide has the right role and the first 8 words of its quote appear on that slide
// (text the model was shown, plus questions and options).
export const verifyCite = (
  slides: Record<number, Slide>,
  c: Cite,
  role: string,
  text = objectivesSlideText,
) => {
  const s = slides[c.slide];
  if (!s || s.role !== role) return false;
  const hay = norm(
    text(s) + "\n" + s.questions.map((q) => [q.text, ...q.options].join(" ")).join("\n"),
  );
  return hay.includes(norm(c.quote).split(" ").slice(0, 8).join(" "));
};

// Fault 3 (base5-1 y2 s12): the model listed practice slide 12 in o1's `look` and then cited no check. The
// slide was in the request in full; the output was complete JSON of about 700 tokens against a cap of 8,000;
// the user turn has no slide cap or kind filter beyond teach/question. So it was an omission, not truncation.
// v2 counted such look-only slides; v3 does not (coordinator, 9 Oct: too lenient). A look-only slide would
// count only if it is a question slide AND the model cited it for this objective with a quote that passes the
// same check as any citation, AND the model did not mark it failing; the first two together are already a
// verified check, and the schema has no "fails" field, so nothing extra ever counts. Look-only slides are
// reported in lookOnly (with the reason) for the prompt fix to be measured against; they never score.
export function summariseObjectives(
  d: { slides: Slide[]; objectives: { id: string; text: string }[] },
  o: { objectives: ObjectiveRow[] },
  opts: { text?: (s: Slide) => string } = {},
) {
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
    const checked = [...new Set(r.checked.filter((c) => ok(c, "question")).map((c) => c.slide))];
    const lookOnly = lookSlides(r.look)
      .filter((n) => sl[n]?.role === "question" && n > firstTeach && !checked.includes(n))
      .map((n) => ({
        slide: n,
        reason: r.checked.some((c) => c.slide === n) ? "cite quote failed" : "no cite",
      }));
    return {
      id: ob.id,
      text: ob.text,
      taught,
      checked,
      lookOnly,
      unverified: [
        ...r.taught.filter((c) => !ok(c, "teach")),
        ...r.checked.filter((c) => !ok(c, "question")),
      ],
    };
  });
}
