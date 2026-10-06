// BAKEOFF arm B: turns one b-drive.ts lesson (the incumbent, as it ships) into the shared run layout
// runs/B/<brief>/: lesson.json (every placed photo carries `request`), timings.json, cost.json,
// log.jsonl, checks.json (slide count), render/. Usage: bun lab/bakeoff/b-post.ts <driveOut> <briefId> <runDir> [--no-render]
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { renderLesson } from "./render";
import { writeJson } from "./services";

type El = { type: string; src?: string; name?: string; request?: string };
type Lesson = {
  slides: { elements: El[] }[];
  facts?: {
    outline?: { imageBrief?: { request?: string; subject?: string; mustShow?: string[] } }[];
  };
};

/** The request text each placed photo was found for: its slide's outline imageBrief (request, else subject + mustShow). */
export function withRequests(lesson: Lesson): { lesson: Lesson; tagged: number; missing: number } {
  let tagged = 0;
  let missing = 0;
  const outline = lesson.facts?.outline ?? [];
  lesson.slides.forEach((s, i) => {
    const b = outline[i]?.imageBrief;
    const req = b
      ? (b.request ?? [b.subject, ...(b.mustShow ?? [])].filter(Boolean).join(". "))
      : undefined;
    for (const e of s.elements) {
      // Drawn diagrams are SVG data URLs: not pictures the director found.
      if (e.type !== "image" || !e.src || e.src.startsWith("data:image/svg")) continue;
      if (req) {
        e.request = req;
        tagged++;
      } else missing++;
    }
  });
  return { lesson, tagged, missing };
}

if (import.meta.main) {
  const [driveOut, id, runDir] = process.argv.slice(2);
  if (!driveOut || !id || !runDir)
    throw new Error("usage: b-post.ts <driveOut> <briefId> <runDir>");
  const lesson = JSON.parse(readFileSync(`${driveOut}/${id}.lesson.json`, "utf8"));
  const { tagged, missing } = withRequests(lesson);
  writeJson(`${runDir}/lesson.json`, lesson);
  const rows = readFileSync(`${driveOut}/rows.jsonl`, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const row = rows.filter((r) => r.brief === id).at(-1) ?? {};
  const v = row.visible_s ?? {};
  const ms = (s: number | null | undefined) =>
    typeof s === "number" ? Math.round(s * 1000) : undefined;
  writeJson(`${runDir}/timings.json`, {
    ms: {
      title: ms(v.title),
      firstTeachingSlide: ms(v.first_content),
      editable: ms(v.editable),
      lastVisual: ms(v.photos_done),
      done: ms(v.done),
    },
    source: "b-drive rows.jsonl visible_s",
  });
  writeJson(`${runDir}/cost.json`, {
    main: row.cost_usd ?? null,
    pictures: row.bank_cost_usd ?? 0,
    total: Number(((row.cost_usd ?? 0) + (row.bank_cost_usd ?? 0)).toFixed(5)),
    note: "main = every pipeline AI call (objectives, writer, fit, pictures' director and judge); pictures = bank generations",
  });
  const n = lesson.slides.length;
  writeJson(`${runDir}/checks.json`, {
    count: { slides: n, min: 9, max: 12, inRange: n >= 9 && n <= 12 },
    requests: { tagged, missing },
  });
  for (const f of ["log.jsonl", "ai.jsonl", "bank.jsonl"])
    if (existsSync(`${driveOut}/${id}.${f}`))
      copyFileSync(
        `${driveOut}/${id}.${f}`,
        `${runDir}/${f === "log.jsonl" ? "log.jsonl" : `b-${f}`}`,
      );
  console.log(id, { slides: n, tagged, missing });
  if (!process.argv.includes("--no-render"))
    console.log("rendered", await renderLesson(`${runDir}/lesson.json`));
}
