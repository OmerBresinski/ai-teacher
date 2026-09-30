/*
 * Score a design-cycle smoke run (free, no model calls): per deck the forms chosen, distinct
 * forms, visuals per objective, check-form variety, worked examples, near-duplicate slides,
 * practice that reuses a worked example's numbers, coverage of the arc's parts, latency and cost;
 * plus greps for the round-1 known errors (electrolysis bromide, rivers speed, Weimar date).
 *
 *   bun eval/design-cycle-score.ts <run dir>
 */
import { readdirSync, readFileSync } from "node:fs";
import type { DesignSlot } from "../src/prompts/design-cycle";

const dir = process.argv[2] ?? ".";
const VISUAL = new Set(["photo", "figure", "diagram-slot"]);
const CHECK = new Set(["hinge", "true-false", "matching", "fill-gap", "sort"]);
const OPEN = new Set(["open-response", "discussion"]);
const TEACH_TEXT = new Set(["explain", "explain-callout", "list", "compare", "sequence"]);

type Cycle = {
  objectiveIndex: number;
  slots: { count: number; first: number };
  output?: { slots: DesignSlot[]; exitQuestion: { question: string; answer: string } };
  error?: string;
  usd: number;
  totalMs: number;
  firstMs: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    outputTokenDetails?: { reasoningTokens?: number };
  };
};
type Run = {
  id: string;
  versions: { objectives: string; cycle: string };
  objectives: {
    output?: { objectives: { text: string; arc?: { angle: string; lean: string } }[] };
    usd?: number;
    totalMs?: number;
  };
  cycles: Cycle[];
};

/** Every text a slot puts on the slide (notes left out). */
function slideText(s: DesignSlot): string {
  const { form: _f, notes: _n, ...rest } = s as DesignSlot & { notes?: string };
  return JSON.stringify(rest);
}
const words = (t: string) =>
  new Set(
    t
      .toLowerCase()
      .replace(/[^a-z0-9£ ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter || 1);
}
const numbers = (t: string) => new Set(t.match(/\d+(?:\.\d+)?/g) ?? []);

const KNOWN: Record<string, { name: string; test: (t: string) => boolean }[]> = {
  "y10-electrolysis": [
    {
      name: "dilute bromide/iodide -> oxygen",
      test: (t) => /(bromide|iodide)[^.]{0,120}oxygen|oxygen[^.]{0,120}(bromide|iodide)/i.test(t),
    },
  ],
  "y5-rivers": [
    {
      name: "upper course fast",
      test: (t) =>
        /(upper course|near (its|the) source|steep)[^.]{0,80}\b(fast|quick|rapid)/i.test(t) ||
        /\b(fast|quick|rapid)[^.]{0,80}(upper course|near (its|the) source)/i.test(t),
    },
  ],
  "y9-weimar": [
    {
      name: "passive resistance October",
      test: (t) =>
        /October[^.]{0,60}passive resistance|passive resistance[^.]{0,60}October/i.test(t),
    },
  ],
  "y3-rocks": [
    { name: "granite dark", test: (t) => /dark[^.]{0,40}granite|granite[^.]{0,40}dark/i.test(t) },
  ],
  "y6-ratio": [{ name: "unit ratio", test: (t) => /unit ratio/i.test(t) }],
};

const rows: string[] = [];
const totals = {
  decks: 0,
  distinct: 0,
  visuals: 0,
  objectives: 0,
  checkForms: new Set<string>(),
  formCount: new Map<string, number>(),
  worked: 0,
  dupPairs: 0,
  reuse: 0,
  first: [] as number[],
  total: [] as number[],
  usd: 0,
  invalid: 0,
  slots: 0,
  checkSlots: 0,
  openSlots: 0,
  roleMisses: 0,
  methodObjWithWE: 0,
  methodObj: 0,
};

for (const file of readdirSync(dir)
  .filter((f) => f.endsWith(".json") && f !== "spend.json")
  .sort()) {
  const run = JSON.parse(readFileSync(`${dir}/${file}`, "utf8")) as Run;
  const objectives = run.objectives.output?.objectives ?? [];
  const deckForms: string[] = [];
  const visualsPerObj: number[] = [];
  const checkForms: string[] = [];
  const slides: { text: string; form: string; obj: number }[] = [];
  let usd = run.objectives.usd ?? 0;
  let worked = 0;
  let reuse = 0;
  const known: string[] = [];
  let firstMax = 0;
  let totalMax = 0;
  let invalid = 0;
  let roleMisses = 0;
  const allText: string[] = [];
  for (const c of run.cycles ?? []) {
    usd += c.usd;
    firstMax = Math.max(firstMax, c.firstMs);
    totalMax = Math.max(totalMax, c.totalMs);
    if (!c.output) {
      invalid++;
      visualsPerObj.push(0);
      continue;
    }
    const arc = objectives[c.objectiveIndex]?.arc;
    const forms = c.output.slots.map((s) => s.form);
    deckForms.push(...forms);
    visualsPerObj.push(forms.filter((f) => VISUAL.has(f)).length);
    for (const f of forms) if (CHECK.has(f)) checkForms.push(f);
    worked += forms.filter((f) => f === "worked-example").length;
    if (arc?.lean === "worked-example") {
      totals.methodObj++;
      if (forms.includes("worked-example")) totals.methodObjWithWE++;
    }
    // Role compliance: the smoke records what design-cycle's helper assigned, when present.
    const roles = (c as unknown as { roles?: string[] }).roles;
    if (roles) {
      forms.forEach((f, i) => {
        const r = roles[i];
        const ok =
          r === "show"
            ? VISUAL.has(f)
            : r === "check"
              ? CHECK.has(f)
              : r === "practise"
                ? OPEN.has(f)
                : TEACH_TEXT.has(f) ||
                  VISUAL.has(f) ||
                  f === "worked-example" ||
                  f === "vocabulary";
        if (!ok) roleMisses++;
      });
    }
    // Practice reusing a worked example's numbers (ratio r1 slide 8/9).
    const wes = c.output.slots.filter((s) => s.form === "worked-example") as Extract<
      DesignSlot,
      { form: "worked-example" }
    >[];
    for (const we of wes) {
      const n = numbers(we.question + " " + we.steps.join(" "));
      for (const s of c.output.slots) {
        if (s === we || !("stem" in s)) continue;
        const m = numbers(s.stem);
        if (
          n.size >= 2 &&
          m.size >= 2 &&
          [...m].filter((x) => n.has(x)).length >= Math.min(2, m.size)
        )
          reuse++;
      }
    }
    for (const s of c.output.slots) {
      slides.push({ text: slideText(s), form: s.form, obj: c.objectiveIndex });
      allText.push(JSON.stringify(s));
    }
    allText.push(JSON.stringify(c.output.exitQuestion));
  }
  // Near-duplicate neighbouring or same-objective slides (rivers 4/5, electrolysis 7/8).
  let dupPairs = 0;
  const dups: string[] = [];
  for (let i = 0; i < slides.length; i++)
    for (let j = i + 1; j < slides.length; j++) {
      const a = slides[i]!;
      const b = slides[j]!;
      if (a.obj !== b.obj) continue;
      const sim = jaccard(words(a.text), words(b.text));
      if (sim >= 0.5) {
        dupPairs++;
        dups.push(`${a.form}/${b.form} ${sim.toFixed(2)}`);
      }
    }
  const text = allText.join("\n") + "\n" + JSON.stringify(objectives);
  for (const k of KNOWN[run.id] ?? []) if (k.test(text)) known.push(k.name);
  const distinct = new Set(deckForms).size;
  const mix = [...new Set(deckForms)]
    .map((f) => `${f} ${deckForms.filter((x) => x === f).length}`)
    .join(", ");
  rows.push(
    `| ${run.id} | ${objectives.length} | ${deckForms.length} | ${distinct} | ${mix} | ${visualsPerObj.join(",")} | ${checkForms.join(",") || "-"} | ${worked} | ${dupPairs}${dups.length ? ` (${dups.join("; ")})` : ""} | ${reuse} | ${known.join("; ") || "-"} | ${(firstMax / 1000).toFixed(1)} / ${(totalMax / 1000).toFixed(1)} | ${usd.toFixed(4)} |${invalid ? ` INVALID ${invalid}` : ""}${roleMisses ? ` roleMiss ${roleMisses}` : ""}`,
  );
  totals.decks++;
  totals.distinct += distinct;
  totals.visuals += visualsPerObj.reduce((s, n) => s + Math.min(1, n), 0);
  totals.objectives += objectives.length;
  for (const f of checkForms) totals.checkForms.add(f);
  for (const f of deckForms) totals.formCount.set(f, (totals.formCount.get(f) ?? 0) + 1);
  totals.worked += worked;
  totals.dupPairs += dupPairs;
  totals.reuse += reuse;
  totals.first.push(firstMax);
  totals.total.push(totalMax);
  totals.usd += usd;
  totals.invalid += invalid;
  totals.slots += deckForms.length;
  totals.checkSlots += deckForms.filter((f) => CHECK.has(f)).length;
  totals.openSlots += deckForms.filter((f) => OPEN.has(f)).length;
  totals.roleMisses += roleMisses;
}
const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.floor((s.length - 1) / 2)]! / 1000).toFixed(1) : "-";
};
console.log(
  `| brief | obj | slots | distinct forms | mix | visuals/obj | check forms | worked ex | dup pairs | WE reuse | known errors | first / total s (max over cycles) | $ |`,
);
console.log(`|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
for (const r of rows) console.log(r);
console.log("");
console.log(
  `decks ${totals.decks}; distinct forms/deck ${(totals.distinct / totals.decks).toFixed(2)}; objectives with a visual ${totals.visuals}/${totals.objectives} (${(totals.visuals / totals.objectives).toFixed(2)}); closed checks ${totals.checkSlots}/${totals.slots} slots, open ${totals.openSlots}/${totals.slots}; check forms used: ${[...totals.checkForms].join(", ") || "none"}; worked examples ${totals.worked} (method-lean objectives with one: ${totals.methodObjWithWE}/${totals.methodObj}); dup pairs ${totals.dupPairs}; WE reuse ${totals.reuse}; invalid cycles ${totals.invalid}; role misses ${totals.roleMisses}; first slot p50 ${med(totals.first)} s, cycle total p50 ${med(totals.total)} s; $${totals.usd.toFixed(4)} total, $${(totals.usd / totals.decks).toFixed(4)}/deck`,
);
console.log(
  `forms: ${[...totals.formCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([f, n]) => `${f} ${n}`)
    .join(", ")}`,
);
