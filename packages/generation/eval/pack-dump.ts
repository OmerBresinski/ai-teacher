#!/usr/bin/env bun
// bun packages/generation/eval/pack-dump.ts --topic <id> --arm <arm> --out <file.md>
//
// A readable dump of one written pack and its report: every fact with the text of the sentences
// it cites, its snippet, its longest verbatim run, any structural issue on it, and both checkers'
// verdicts side by side with whether they agree. Also prints one JSON line of per-arm counts for
// the log. No model calls; nothing here judges — the counts are tallies of recorded declarations.

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadExperiment } from "./experiments/np1";
import type { AuthorReport } from "./pack-author";
import { checkFactText } from "./packs/prompts";
import { FACT_TYPES, type Pack, PackSchema } from "./packs/schema";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const exp = loadExperiment();
const topicId = arg("topic");
const arm = arg("arm");
const out = arg("out");
const topic = exp.topics.find((t) => t.id === topicId);
if (!topic || !arm || !out) {
  console.error("usage: pack-dump.ts --topic <id> --arm <arm> --out <file.md>");
  process.exit(2);
}
const dir = join(import.meta.dir, "results", "packs", `${topic.id}.${arm}`);
const pack: Pack = PackSchema.parse(
  await Bun.file(join(import.meta.dir, "packs", `${topic.id}.${arm}.json`)).json(),
);
const report = (await Bun.file(join(dir, "report.json")).json()) as AuthorReport & {
  durationMs?: number;
  retryDurationMs?: number;
  recheckDurationMs?: number;
};
// Every ledger in the run dir (the first run, retries of failed sections, rechecks): all attempts count.
const ledgers = [];
for (const f of (await readdir(dir)).filter((x) => /^ledger.*\.json$/.test(x)).sort())
  ledgers.push(await Bun.file(join(dir, f)).json());
const sentenceById = new Map(pack.sources.flatMap((s) => s.sentences.map((x) => [x.id, x.text])));

type Verdict = { fact: number; supportedByEvidence: string; correct: string; note: string };
const tally = {
  facts: 0,
  byType: {} as Record<string, number>,
  schemaIssues: report.issues,
  overlapFlagged: report.flagged,
  luna: {
    supported: { yes: 0, partly: 0, no: 0 },
    correct: { yes: 0, no: 0, unsure: 0 },
    missing: 0,
  },
  sol: {
    supported: { yes: 0, partly: 0, no: 0 },
    correct: { yes: 0, no: 0, unsure: 0 },
    missing: 0,
  },
  agree: { supported: 0, correct: 0, both: 0, compared: 0 },
};
const L: string[] = [
  `# ${topic.id} / ${arm}`,
  "",
  `Pack ${pack.id}, written ${pack.writtenAt} by ${pack.provenance.writer} (${pack.provenance.writerPrompt}); checkers ${exp.models.checkerLuna} (luna) and ${exp.models.checkerSol} (sol), pack-check.v1, blind to each other.`,
  `Status: executed ${report.status.executed}, complete ${report.status.complete}${report.status.incomplete.length ? `; incomplete: ${report.status.incomplete.join("; ")}` : ""}.`,
  "Verdict columns: `supported` = supportedByEvidence (yes/partly/no); `correct` = correct (yes/no/unsure); `agree` = both checkers gave the same word on that column. Nothing here ranks; the tallies count declarations as recorded.",
  "",
  "## Sources",
  ...pack.sources.map(
    (s) =>
      `- ${s.id}: ${s.title} (${s.url}, rev ${s.revision}, ${s.licence}, ${s.sentences.length} sentences)`,
  ),
  "",
];
for (const section of pack.sections) {
  const r = report.sections.find((x) => x.id === section.id);
  if (!r) continue;
  L.push(`## ${section.id}: ${section.outcome}`, "");
  L.push(
    `Window ${r.window} sentences (${section.sentenceIds[0]} … ${section.sentenceIds.at(-1)}). Timings: write ${r.timings.writeMs} ms, check ${r.timings.checkMs} ms. Overlap flags: ${r.overlap.filter((o) => o.overlap.flagged).length}. Structural issues: ${r.issues.length}.`,
    "",
  );
  const luna = new Map((r.checks.luna ?? []).map((v: Verdict) => [v.fact, v]));
  const sol = new Map((r.checks.sol ?? []).map((v: Verdict) => [v.fact, v]));
  let n = 0;
  for (const type of FACT_TYPES) {
    const items = section.facts[type] as {
      evidence: { sentenceIds: string[]; snippet: string }[];
    }[];
    items.forEach((fact, index) => {
      const k = n++;
      tally.facts += 1;
      tally.byType[type] = (tally.byType[type] ?? 0) + 1;
      const ov = r.overlap.find((o) => o.type === type && o.index === index);
      const issues = r.issues.filter((i) => i.path.includes(`.${type}[${index}]`));
      L.push(`### f${k} (${type}[${index}])`, "", checkFactText(type, fact), "");
      if (type === "questions") {
        const q = fact as unknown as { tier: string; use: string; demand: string; forms: string[] };
        L.push(`- tier ${q.tier}, use ${q.use}, demand ${q.demand}, forms ${q.forms.join("/")}`);
      }
      if (type === "vocabulary") {
        const v = fact as unknown as { sense: string; band: string };
        L.push(`- sense: ${v.sense}; band ${v.band}`);
      }
      for (const e of fact.evidence) {
        L.push(`- snippet: "${e.snippet}"`);
        for (const id of e.sentenceIds)
          L.push(`  - ${id}: ${sentenceById.get(id) ?? "(not in sources)"}`);
      }
      if (ov)
        L.push(
          `- longest verbatim run: ${ov.overlap.longest} words${ov.overlap.flagged ? " (FLAGGED ≥ 8)" : ""}${ov.overlap.sentenceId ? ` (with ${ov.overlap.sentenceId})` : ""}`,
        );
      for (const i of issues) L.push(`- structural issue: ${i.issue} at ${i.path}: ${i.detail}`);
      const lv = luna.get(k);
      const sv = sol.get(k);
      const cell = (v: Verdict | undefined) =>
        v
          ? `${v.supportedByEvidence} / ${v.correct}${v.note ? ` — ${v.note}` : ""}`
          : "(no verdict)";
      L.push(`- luna: ${cell(lv)}`, `- sol: ${cell(sv)}`);
      for (const [key, v] of [
        ["luna", lv],
        ["sol", sv],
      ] as const) {
        const t = tally[key];
        if (!v) {
          t.missing += 1;
          continue;
        }
        t.supported[v.supportedByEvidence as "yes"] += 1;
        t.correct[v.correct as "yes"] += 1;
      }
      if (lv && sv) {
        tally.agree.compared += 1;
        const a = lv.supportedByEvidence === sv.supportedByEvidence;
        const b = lv.correct === sv.correct;
        if (a) tally.agree.supported += 1;
        if (b) tally.agree.correct += 1;
        if (a && b) tally.agree.both += 1;
        L.push(`- agree: supported ${a ? "yes" : "NO"}, correct ${b ? "yes" : "NO"}`);
      }
      L.push("");
    });
  }
}
const usd = ledgers.reduce((s, l) => s + (l.all?.usd ?? 0), 0);
const calls = ledgers.reduce((s, l) => s + (l.all?.calls ?? 0), 0);
const rows = ledgers.flatMap(
  (l) =>
    l.rows as {
      stage: string;
      model: string;
      calls: number;
      inputTokens: number;
      outputTokens: number;
      usd: number;
    }[],
);
L.push(
  "## Cost and latency",
  "",
  "| stage | model | calls | in | out | USD |",
  "|---|---|---:|---:|---:|---:|",
);
for (const r of rows)
  L.push(
    `| ${r.stage} | ${r.model} | ${r.calls} | ${r.inputTokens} | ${r.outputTokens} | $${r.usd.toFixed(4)} |`,
  );
L.push(`| **total** | | ${calls} | | | **$${usd.toFixed(4)}** |`, "");
L.push(
  `Wall clock: authoring run ${report.durationMs ?? "(none: partial run)"}${report.durationMs ? " ms" : ""}${report.retryDurationMs ? `, retry/partial run ${report.retryDurationMs} ms` : ""}${report.recheckDurationMs ? `, recheck ${report.recheckDurationMs} ms` : ""}. Per section: write ${report.sections.map((s) => `${s.id} ${s.timings.writeMs} ms`).join(", ")}; check ${report.sections.map((s) => `${s.id} ${s.timings.checkMs} ms`).join(", ")}.`,
  "",
);
L.push(
  "## Tally (declarations as recorded)",
  "",
  "```json",
  JSON.stringify({ ...tally, usd: Number(usd.toFixed(4)), calls }, null, 2),
  "```",
  "",
);
await Bun.write(out, `${L.join("\n")}\n`);
console.log(JSON.stringify({ topic: topic.id, arm, ...tally, usd: Number(usd.toFixed(4)), calls }));
