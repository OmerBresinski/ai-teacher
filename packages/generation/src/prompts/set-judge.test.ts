import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { SET_JUDGE_SYSTEM, SetJudgeSchema, setJudgePrompt } from "./set-judge";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const pin = (f: string) => readFileSync(join(import.meta.dir, "base4-pins", f), "utf8");

/** The base4 entries of the lab's ab/PINS.json for these two files (lab/ab 92f1b36d). */
const LAB_PINS = {
  "set-judge.base4.txt": "e60d46928e7b84acc6e73257dac1f90c3286fc64e9fde1794efbabeca9b650d9",
  "set-judge-schema.base4.json.txt":
    "73eab1668569cefb9a2f9c2594d33eb7a848bd8ccab8a952f95a1a8154fdb3ad",
};

describe("set judge pins", () => {
  test("the copied lab files carry the lab's PINS.json hashes", () => {
    for (const [f, h] of Object.entries(LAB_PINS)) expect(sha(pin(f))).toBe(h);
  });
  test("the system prompt is the pinned text byte for byte", () => {
    expect(SET_JUDGE_SYSTEM).toBe(pin("set-judge.base4.txt"));
    expect(sha(SET_JUDGE_SYSTEM)).toBe(LAB_PINS["set-judge.base4.txt"]);
  });
  test("the schema is the pinned JSON schema", () => {
    const want = JSON.parse(pin("set-judge-schema.base4.json.txt"));
    const got = z.toJSONSchema(SetJudgeSchema) as Record<string, unknown>;
    expect(got.type).toBe(want.type);
    expect(got.required).toEqual(want.required);
    expect(got.additionalProperties).toBe(false);
    expect(got.properties).toMatchObject(want.properties);
  });
  test("the user message names each panel in order, as base4 did", () => {
    expect(setJudgePrompt.user({ shows: ["A chick", "A hen"] })).toBe(
      "Panel 1: A chick\nPanel 2: A hen",
    );
  });
});
