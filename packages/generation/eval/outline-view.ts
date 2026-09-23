/*
 * Lab view of the outline step (no model call, no spend): run `outlineFromFacts` over the five
 * merged-facts fixtures at every slide count and write one Markdown file to read the outlines
 * side by side. Usage: `bun run eval/outline-view.ts [outDir]`.
 */
import { SLIDE_COUNTS } from "@tj/domain/documents";
import macbeth from "../src/fixtures/objective-facts.ks4-english-literature-macbeth.json";
import elasticity from "../src/fixtures/objective-facts.post16-economics-elasticity.json";
import romans from "../src/fixtures/objective-facts.y4-history-romans.json";
import ratio from "../src/fixtures/objective-facts.y6-maths-ratio.json";
import evolution from "../src/fixtures/objective-facts.y6-science-evolution.json";
import { type OutlineFacts, outlineFromFacts } from "../src/outline-from-facts";
import { lessonShapeOf } from "../src/shapes";
import { planSkeletonSchemaFor } from "../src/specs";

const FIXTURES = [romans, ratio, evolution, macbeth, elasticity];
const outDir = process.argv[2] ?? "eval/results/lab/outline-1";

const short = (text: string, n = 90) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

const lines: string[] = ["# Outline from facts — five briefs × four slide counts", ""];
for (const f of FIXTURES) {
  const facts = f.facts as unknown as OutlineFacts;
  const shape = lessonShapeOf(f.answers, { yearGroup: f.yearGroup });
  lines.push(
    `## ${f.id} — ${f.topic}`,
    "",
    `${f.yearGroup} ${f.subject}, ${f.durationMin} min, ${shape.verb} / ${shape.confidence}. Facts: ${facts.keyIdeas.length} key ideas, ${facts.misconceptions.length} misconceptions, ${facts.vocabulary.length} terms, ${facts.workedExamples.length} worked examples, ${facts.questions.length} questions (${facts.questions.filter((q) => q.use === "slide" || q.use === "any").length} slide, ${facts.questions.filter((q) => q.use === "exit").length} exit, ${facts.questions.filter((q) => q.use === "worksheet").length} worksheet).`,
    "",
    "Objectives:",
    ...f.objectives.map((o, i) => `${i}. ${o.text}`),
    "",
  );
  for (const slideCount of SLIDE_COUNTS) {
    const result = outlineFromFacts({
      topic: f.topic,
      objectives: f.objectives,
      facts,
      shape,
      slideCount,
    });
    const check = planSkeletonSchemaFor({ shape, slideCount }).safeParse(result.skeleton);
    const issues = check.success
      ? []
      : check.error.issues.filter((i) => i.path[0] !== "photographable").map((i) => i.message);
    const refsAt = new Map(result.outlineFactRefs.map((e) => [e.index, e.factRefs]));
    const describeRef = (r: { type: string; index: number }) => {
      switch (r.type) {
        case "keyIdea":
          return `k${r.index + 1} ${short(facts.keyIdeas[r.index]?.statement ?? "", 70)}`;
        case "workedExample":
          return `x${r.index + 1} ${short(facts.workedExamples[r.index]?.problem ?? "", 70)}`;
        case "question":
          return `q${r.index + 1} ${short(facts.questions[r.index]?.stem ?? "", 70)}`;
        case "misconception":
          return `m${r.index + 1} ${short(facts.misconceptions[r.index]?.belief ?? "", 70)}`;
        case "vocabulary":
          return `v${r.index + 1} ${facts.vocabulary[r.index]?.term ?? ""}`;
        default:
          return `${r.type}${r.index}`;
      }
    };
    lines.push(
      `### ${slideCount} slides — ${issues.length === 0 ? "shape check pass" : `shape issues: ${issues.length}`}`,
      "",
      "| # | kind | phase | obj | facts | callout | adds |",
      "|---|---|---|---|---|---|---|",
    );
    result.skeleton.outline.forEach((e, i) => {
      const obj = e.factRefs.map((r) => r.index).join(",");
      const facts = (refsAt.get(i) ?? []).map(describeRef).map(cell).join("<br>");
      const c = result.callouts[i];
      const callout = c ? `${c.kind}: ${cell(short(c.text, 70))}` : "";
      lines.push(
        `| ${i} | ${e.kind} | ${e.phase ?? ""} | ${obj} | ${facts} | ${callout} | ${cell(e.brief?.adds ?? "")}${e.brief?.avoids ? `<br>_avoids: ${cell(e.brief.avoids)}_` : ""} |`,
      );
    });
    lines.push("");
    lines.push(
      `Coverage: ${result.coverage.map((c, i) => `o${i} taught ${c.taught.join("/") || "—"}, practised ${c.practised.join("/") || "—"}, checked ${c.checked.join("/") || "—"}`).join("; ")}.`,
    );
    const u = result.unplaced;
    lines.push(
      `Unplaced: key ideas ${u.keyIdeas.length}, worked examples ${u.workedExamples.length}, questions ${u.questions.length}.`,
    );
    if (result.gaps.length > 0) lines.push(`Gaps: ${result.gaps.join(" ")}`);
    if (issues.length > 0) lines.push(`Shape issues: ${issues.join(" | ")}`);
    lines.push("");
  }
}
await Bun.write(`${outDir}/OUTLINES.md`, `${lines.join("\n")}\n`);
console.log(`wrote ${outDir}/OUTLINES.md`);
