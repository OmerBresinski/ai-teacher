import { describe, expect, test } from "bun:test";
import { pilotRequest } from "./pilot-pack";
import { replayRun } from "./replay-fixture";

/*
 * TEACH-247 part bc: the paid proof of pack v4.17 opened no slide during the writer call
 * ("stream-stopped: slide 1 out of order"). v4.17 had moved `title` before `flow` in the schema,
 * and the stage opens nothing before the flow has closed. A saved writer output, rewritten in
 * v4.17's key order and streamed piece by piece, must open its slides before the stream ends.
 */
const LESSON = "y5-maths-fractions-of-amounts";
type J = Record<string, unknown>;

const reorder = (keys: string[]) => (text: string) => {
  const d = JSON.parse(text) as J;
  const rest = Object.keys(d).filter((k) => !keys.includes(k));
  return JSON.stringify(
    Object.fromEntries([...keys, ...rest].filter((k) => k in d).map((k) => [k, d[k]])),
  );
};
const pieces = (text: string) => {
  const out: string[] = [];
  for (let at = 0; at < text.length; at += 40) out.push(text.slice(at, at + 40));
  return out;
};

async function slidesBeforeEnd(keys: string[]) {
  const events: string[] = [];
  await replayRun(LESSON, {
    text: reorder(keys),
    stream: pieces,
    onStreamEnd: () => events.push("end"),
    hooks: { onSlide: (i) => events.push(`slide:${i}`) },
  });
  const end = events.indexOf("end");
  return events.slice(0, end).filter((e) => e.startsWith("slide:")).length;
}

describe("pack v4.17 streams slide by slide", () => {
  test("in v4.17's schema order, slides open before the writer call ends", async () => {
    const keys = Object.keys(pilotRequest("v4.17", "KS2", {}, (s) => s).schema.properties as J);
    expect(await slidesBeforeEnd(keys)).toBeGreaterThan(2);
  });

  test("the regression it guards: title before flow opens nothing mid-call", async () => {
    expect(await slidesBeforeEnd(["design", "title", "flow", "slides"])).toBe(0);
  });
});
