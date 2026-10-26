import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLACEHOLDER_IMAGE } from "@tj/slides/layouts";
import type { Brief } from "./fixes";
import type { VisualState } from "./materialise";
import { replayServices } from "./replay-fixture";
import { runWriter } from "./stage";

/*
 * picq (greatfire 26 Oct): a teacher never gets a slide showing the grey placeholder. When writing
 * ends, every picture slot is filled, laid again without the slot, or replaced by a ruled fallback.
 * Here every picture fails (first round and every retry) and the drawer is down.
 */
const read = (b: string, f: string) =>
  JSON.parse(readFileSync(join(import.meta.dir, "fixtures/replay", b, f), "utf8"));
const placeholders = (slides: unknown) =>
  JSON.stringify(slides).split(JSON.stringify(PLACEHOLDER_IMAGE).slice(1, -1)).length - 1;

const run = (b: string, state: () => VisualState, settled = { on: true }) =>
  runWriter({
    beforeEditable: async () => {
      settled.on = true;
    },
    brief: read(b, "brief.json") as Brief,
    objectives: (
      read(b, "objectives.json") as { objectives: { teacher: string }[] }
    ).objectives.map((o) => o.teacher),
    services: {
      ...replayServices(b),
      writer: async () => ({
        text: (read(b, "main.json") as { text: string }).text,
        finishReason: "stop",
        usd: 0,
        ms: 0,
      }),
    },
    visual: (_i, _k, a) =>
      a.type === "photo" ? (settled.on ? state() : { status: "pending" }) : { status: "failed" },
    drawDiagrams: {
      callDrawer: async () => {
        throw new Error("drawer down");
      },
    },
    retryable: () => true,
    placeMore: async () => undefined,
  });

/**
 * As the real picture director behaves: every ask pending while the words stream, failed once the
 * round settles; a later round (placeMore) is pending again until its own settle, then failed;
 * an early retry starts when a slide's first round is over (slideDone).
 */
const realistic = (b: string) => {
  const st = new Map<string, VisualState>();
  let settled = false;
  return runWriter({
    brief: read(b, "brief.json") as Brief,
    objectives: (
      read(b, "objectives.json") as { objectives: { teacher: string }[] }
    ).objectives.map((o) => o.teacher),
    services: {
      ...replayServices(b),
      writer: async () => ({
        text: (read(b, "main.json") as { text: string }).text,
        finishReason: "stop",
        usd: 0,
        ms: 0,
      }),
    },
    visual: (i, k, a) =>
      a.type !== "photo"
        ? { status: "failed" }
        : (st.get(`${i}:${k}`) ?? (settled ? { status: "failed" } : { status: "pending" })),
    beforeEditable: async () => {
      await new Promise((r) => setTimeout(r, 5));
      settled = true;
    },
    slideDone: async () => {
      await new Promise((r) => setTimeout(r, 1));
    },
    drawDiagrams: {
      callDrawer: async () => {
        throw new Error("drawer down");
      },
    },
    retryable: () => true,
    canReask: () => true,
    placeMore: async (i, more) => {
      for (const a of more) st.set(`${i}:${a.key}`, { status: "pending" });
      await new Promise((r) => setTimeout(r, 3));
      for (const a of more) st.set(`${i}:${a.key}`, { status: "failed" });
    },
  });
};

describe("no lesson ships a placeholder when its pictures fail (picq)", () => {
  for (const b of [
    "y1-science-animals-young",
    "y2-maths-halves-quarters",
    "y5-maths-fractions-of-amounts",
    "y12-psychology-multi-store-model",
  ])
    test(`${b}: every picture failed`, async () => {
      const out = await run(b, () => ({ status: "failed" }));
      expect(placeholders(out.slides)).toBe(0);
    });
  for (const b of [
    "y1-science-animals-young",
    "y2-maths-halves-quarters",
    "y5-maths-fractions-of-amounts",
  ])
    test(`${b}: pictures pending while written, failed once settled`, async () => {
      const out = await run(b, () => ({ status: "failed" }), { on: false });
      expect(placeholders(out.slides)).toBe(0);
    });
  for (const b of [
    "y1-science-animals-young",
    "y2-maths-halves-quarters",
    "y5-maths-fractions-of-amounts",
    "y12-psychology-multi-store-model",
  ])
    test(`${b}: realistic rounds, every picture fails`, async () => {
      const out = await realistic(b);
      expect(placeholders(out.slides)).toBe(0);
    });
});
