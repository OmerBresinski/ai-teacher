// Round 6 ($0): compile the y1 requests arm y1fix sends (writer request from check.ts's compiled set, and the
// batched picture-director request built exactly as services.ts builds it, through a recording fake model)
// and check the director v12 lines are in them. bun lab/bakeoff/ab/y1fixsmoke.ts
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createBudget } from "../../../packages/ai/src/index";
import { createFakeAi } from "../../../packages/ai/src/testing";
import {
  createDirectorBatcher,
  useDirectorVersion,
} from "../../../packages/generation/src/stages/picture-director";
import { AB, abShared, pictureVersions, setAbArm } from "./arms";

setAbArm("y1fix");
useDirectorVersion(pictureVersions("y1fix").director); // as run.ts does
const batchFile = `${abShared()}/director-batch.txt`;
const V12 = [
  "A living thing qualifies only as it is usually photographed",
  "Also an unnamed living thing the slide needs at a particular age, growth stage or sex",
  "For a living thing at a particular stage, one item is a feature that shows the stage.",
  "For a living thing at a particular age, stage or sex, it names that stage",
];
const ai = createFakeAi({ script: ["{}"], usage: { inputTokens: 1, outputTokens: 1 } });
const quiet: Record<string, unknown> = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child: () => quiet,
};
const direct = createDirectorBatcher(
  {
    ai,
    budget: createBudget({ capUsd: 0.05, capTokens: 2_000_000 }),
    effortFor: () => "low",
    signal: new AbortController().signal,
    logger: quiet,
    now: () => new Date(),
    ids: () => "x",
    context: { lessonId: "smoke", jobId: "smoke" },
  } as never,
  readFileSync(batchFile, "utf8"),
  50,
);
// The y1 picture slots b4-r1t's writer asked for (base4 full run b3-r2-1), as services sends them.
const run = `${AB}/runs/b3-r2-1/T/y1-science-animals-young`;
const starts = readFileSync(`${run}/log.jsonl`, "utf8")
  .split("\n")
  .filter((l) => l.includes('"picture-start"'))
  .map((l) => JSON.parse(l) as { key: string; shows: string; aspect?: number });
await Promise.all(
  starts.slice(0, 6).map((s) =>
    direct({
      yearGroup: "Year 1",
      subject: "Science",
      title: "Animals and their young",
      country: "England",
      heading: s.key,
      text: "",
      point: "",
      request: s.shows,
      mustShow: [],
      aspect: s.aspect ?? 1.6,
    }).catch((e) => console.log("ERR", String(e).slice(0, 300))),
  ),
);
// The batched call sends the batch file verbatim as its system text (directPictures); the fake model
// records the user turns and the call context, so the system is checked at its source.
const calls = (
  ai as unknown as { calls: { context?: { promptVersion?: string }; promptText: string }[] }
).calls;
const sent = readFileSync(batchFile, "utf8");
const versions = [...new Set(calls.map((c) => c.context?.promptVersion))];
const compiled = `${AB}/compiled/y1fix/y1-science-animals-young.json`;
const writer = existsSync(compiled) ? [compiled.slice(AB.length + 1)] : [];
const lines = V12.map((l) => `${sent.includes(l) ? "FOUND  " : "MISSING"} ${l}`);
const out = [
  `batch file: ${batchFile.slice(AB.length + 1)}; slots sent: ${Math.min(6, starts.length)}; director calls recorded: ${(ai as unknown as { calls: unknown[] }).calls.length}`,
  `director call versions: ${versions.join(", ")}`,
  ...lines,
  `writer compiled files for y1fix: ${writer.join(", ") || "(none)"}`,
];
writeFileSync(`${AB}/y1fix-smoke.txt`, `${out.join("\n")}\n`);
console.log(out.join("\n"));
if (
  !versions.every((v) => String(v).startsWith("picture-director.v12")) ||
  !existsSync(batchFile) ||
  lines.some((l) => l.startsWith("MISSING"))
)
  process.exit(1);
