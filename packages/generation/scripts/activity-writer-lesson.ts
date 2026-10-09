/**
 * TEACH-101 part c: the activity fixture writer output run through the writer stage on a fake
 * model (no paid calls), with the e2e's cached photos for the cards it has and none for the rest
 * (those cards show their words). Writes the slides the e2e screenshots seed:
 * `bun packages/generation/scripts/activity-writer-lesson.ts <out.json>`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { Brief } from "../src/writer/fixes";
import fixture from "../src/writer/fixtures/activities/y1-animals.json" with { type: "json" };
import type { VisualState } from "../src/writer/materialise";
import { runWriter } from "../src/writer/stage";

const out = process.argv[2];
if (!out) throw new Error("usage: activity-writer-lesson.ts <out.json>");
const credits = JSON.parse(
  readFileSync(
    new URL("../../../apps/web/e2e/fixtures/activities/credits.json", import.meta.url),
    "utf8",
  ),
) as Record<string, { aspect: number; subjects?: never }>;
/** A card's label to a cached photo; cards with none fail and become word cards. */
const PHOTOS: Record<string, string> = {
  chick: "chicks",
  lamb: "lamb",
  tadpole: "tadpole-big",
  sheep: "sheep",
  cow: "cow",
  frog: "frog",
};
const main = fixture.main as { slides: { cards?: { label: string }[] }[] };
const visual = (i: number, key: string): VisualState => {
  const n = Number(key.split(".")[1]);
  const label = key.startsWith("card.") ? main.slides[i - 2]?.cards?.[n]?.label : undefined;
  const name = label ? PHOTOS[label] : undefined;
  const c = name ? credits[name] : undefined;
  if (!name || !c) return { status: "failed" };
  return {
    status: "photo",
    photo: {
      src: `/files/act/${name}.jpg`,
      alt: label ?? name,
      aspect: c.aspect,
      ...(c.subjects ? { subjects: c.subjects } : {}),
    },
  };
};
const run = await runWriter({
  brief: fixture.brief as unknown as Brief,
  objectives: fixture.objectives,
  activities: true,
  pupilWording: false,
  visual,
  services: {
    log: () => {},
    writer: async () =>
      ({ text: JSON.stringify(fixture.main), usd: 0, ms: 1, finishReason: "stop" }) as never,
    chat: async () => {
      throw new Error("the fixture run makes no other call");
    },
  },
});
writeFileSync(out, `${JSON.stringify({ slides: run.slides, checks: run.checks }, null, 1)}\n`);
console.log(run.slides.length, "slides");
