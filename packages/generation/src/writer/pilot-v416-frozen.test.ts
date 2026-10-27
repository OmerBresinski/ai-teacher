import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { SLIDE_TIER_RANGES } from "@tj/domain/documents";
import { pilotRequest } from "./pilot-pack";
import { type WriterStage, writerSchema } from "./schema";

/*
 * Live pack v4.16's request is frozen: a switch a later pack turns on (such as `reasonsPicture`,
 * TEACH-247 part ba) must leave it byte-identical. The hashes are origin/master's at 3bfa799.
 */
const FROZEN: Record<WriterStage, string> = {
  KS1: "dbc2e279b56a834f",
  KS2: "d47ef80203e766ce",
  "KS3-5": "45c8aa3a590290ba",
};

describe("pack v4.16's request", () => {
  for (const [stage, hash] of Object.entries(FROZEN) as [WriterStage, string][])
    test(`${stage} is byte-identical to master's`, () => {
      const req = pilotRequest(
        "v4.16",
        stage,
        writerSchema(stage, SLIDE_TIER_RANGES.standard),
        (s) => s,
      );
      const sha = createHash("sha256").update(JSON.stringify(req)).digest("hex").slice(0, 16);
      expect(sha).toBe(hash);
    });
});
