import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { SLIDE_TIER_RANGES } from "@tj/domain/documents";
import { pilotRequest } from "./pilot-pack";
import { type WriterStage, writerSchema } from "./schema";

/*
 * Live pack v4.17's request is frozen: a switch a later pack turns on (v4.18's `flowGroup`, its text edits and
 * learning-cycles block) must leave it byte-identical. The hashes are PR #706's at 66c56502b.
 */
const FROZEN: Record<WriterStage, string> = {
  KS1: "49b71329d28f3d9f",
  KS2: "65e1176f58469147",
  "KS3-5": "8adb5ba0b9342403",
};

describe("pack v4.17's request", () => {
  for (const [stage, hash] of Object.entries(FROZEN) as [WriterStage, string][])
    test(`${stage} is byte-identical to PR #706's`, () => {
      const req = pilotRequest(
        "v4.17",
        stage,
        writerSchema(stage, SLIDE_TIER_RANGES.standard),
        (s) => s,
      );
      const sha = createHash("sha256").update(JSON.stringify(req)).digest("hex").slice(0, 16);
      expect(sha).toBe(hash);
    });
});
