import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Brief } from "./fixes";
import { recordedHeld, recordedVisuals, replayServices } from "./replay-fixture";
import type { WriterServices } from "./services";
import { runWriter } from "./stage";

/*
 * TEACH-110 part ao: a tier's deck 1 or 2 under its minimum ships as written, with a count-miss
 * log line, after one writer call. Never a retry: a second run would double the cost and splice
 * two attempts' slides.
 */
const B = "y5-maths-fractions-of-amounts";
const DIR = join(import.meta.dir, "fixtures/replay", B);
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8"));

test("a deck two under the tier's minimum ships once, logged", async () => {
  const main = read("main.json") as { text: string };
  const out = JSON.parse(main.text) as { slides: unknown[]; close?: unknown };
  const deck = out.slides.length + (out.close ? 1 : 0) + 2;
  const brief = { ...(read("brief.json") as Brief), slides: { min: deck + 2, max: deck + 5 } };
  const replay = replayServices(B);
  let writerCalls = 0;
  const logs: { ev?: string }[] = [];
  const services: WriterServices = {
    ...replay,
    log: (e: object) => logs.push(e as { ev?: string }),
    writer: async () => {
      writerCalls++;
      return { text: main.text, finishReason: "stop", usd: 0, ms: 0 };
    },
  };
  const r = await runWriter({
    brief,
    objectives: (read("objectives.json") as { objectives: { teacher: string }[] }).objectives.map(
      (o) => o.teacher,
    ),
    services,
    visual: recordedVisuals(B),
    placeMore: recordedVisuals(B).placeMore,
    held: recordedHeld(B),
  });
  expect(writerCalls).toBe(1);
  expect(r.slides.length).toBe(deck);
  expect(logs.some((e) => e.ev === "count-miss")).toBe(true);
});
