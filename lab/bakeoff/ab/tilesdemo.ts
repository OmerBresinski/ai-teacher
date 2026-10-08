// b4-r1t3 photo tiles demo (Greg, 8 Oct): the y1 "Find the pairs" slide with cow, calf, sheep and lamb tiles,
// (a) real photos per tile (saved Pexels picks from base4 y1 runs) and (b) one generated strip cut apart.
// bun lab/bakeoff/ab/tilesdemo.ts real|gen <outDir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { setImagePrompt, setSize } from "../../../packages/generation/src/stages/picture-set";
import * as im from "../../../packages/images/src";
import { layoutTemplate } from "../../../packages/slides/src/templates";
import { getTheme, withKeyStage } from "../../../packages/slides/src/themes";
import { renderLesson } from "../render";
import { STORE } from "../services";

const [mode, out] = [process.argv[2] ?? "real", process.argv[3] ?? "/tmp/tiles"];
mkdirSync(out, { recursive: true });
const WS = "0e7a1000-0000-4000-8000-000000000e7a";
// Pairs in order [adult, young, adult, young]; tileMode "shuffled" sets each adult beside another pair's young.
const subjects = [
  { shows: "An adult cow standing alone", file: "images/01a118c4-ca5d-744b-8ae4-9a11bc010cd3.jpg" },
  { shows: "A young calf standing alone", file: "images/01a118c4-bc78-740d-a605-5025a579ad97.jpg" },
  {
    shows: "An adult sheep standing alone",
    file: "images/01a11796-82a0-75f7-b36b-26debcf8d171.jpg",
  },
  { shows: "A young lamb standing alone", file: "images/01a1179a-95af-73ad-a55b-2e087b9b442e.jpg" },
];
let srcs: string[];
let cost = 0;
if (mode === "gen") {
  const gen = im.createOpenAiImageGenerator({
    apiKey: readFileSync(`${homedir()}/.dayback-openai-key`, "utf8").trim(),
  });
  const prompt = setImagePrompt(
    subjects.map((s) => s.shows),
    undefined,
    false,
  );
  writeFileSync(`${out}/prompt.txt`, prompt);
  const made = await gen.generate({ prompt, size: setSize(subjects.length) } as never);
  cost = (made as { costUsd: number }).costUsd;
  writeFileSync(`${out}/strip.png`, made.bytes);
  const panels = im.splitPanels(made.bytes, subjects.length, 4 / 3);
  const dup = im.duplicatePanels(panels);
  if (dup.length) throw new Error(`strip repeats a panel: ${JSON.stringify(dup)}`);
  srcs = panels.map((p, k) => {
    const key = `${WS}/sets/r1t3-tiles-${k}.png`;
    mkdirSync(`${STORE}/${WS}/sets`, { recursive: true });
    writeFileSync(`${STORE}/${key}`, p);
    writeFileSync(`${out}/panel-${k}.png`, p);
    return `/files/${key}`;
  });
} else srcs = subjects.map((s) => `/files/${WS}/${s.file}`);
const tile = (k: number) => ({ photo: srcs[k] as string, alt: subjects[k]?.shows, aspect: 4 / 3 });
const theme = withKeyStage("ks1", () => getTheme("splash", "ks1"));
const r = withKeyStage("ks1", () =>
  layoutTemplate(
    {
      template: "question-set",
      heading: "Find the pairs",
      questions: [
        "Which young animal goes with the cow?",
        "Which young animal goes with the sheep?",
        "What are the young animals called?",
      ],
      instruction: "Point to each pair. Say its names.",
      figure: { ...tile(0), tiles: [tile(1), tile(2), tile(3)], tileMode: "shuffled" },
    },
    theme,
    "ks1",
  ),
);
const now = new Date().toISOString();
const file = `${out}/lesson.json`;
writeFileSync(
  file,
  JSON.stringify({
    version: 1,
    id: `r1t3-tiles-${mode}`,
    title: "Find the pairs",
    themeId: "splash",
    subject: "science",
    ageBand: "ks1",
    yearGroup: "Year 1",
    language: "en-GB",
    createdAt: now,
    updatedAt: now,
    slides: [{ id: "s1", ...r.slide, notes: "" }],
  }),
);
console.log(
  JSON.stringify({
    mode,
    cost,
    overflow: r.slide ? undefined : "none",
    rendered: await renderLesson(file, out),
  }),
);
