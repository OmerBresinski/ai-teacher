import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pickOrRequeryPrompt } from "./pick-or-requery-photo-directed";
import { PICTURE_DIRECTOR_VERSION, pictureDirectorPrompt } from "./picture-director";
import { PICTURE_DIRECTOR_BATCH_SYSTEM } from "./picture-director-batch";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * The pins: the director (v11), its batched prompt and the photo judge (v17) as the writer planner
 * ships them. A wording change bumps the version and this hash in the same commit.
 */
describe("picture prompt pins", () => {
  test("the batched director prompt is the pinned file, byte for byte", () => {
    expect(sha(PICTURE_DIRECTOR_BATCH_SYSTEM)).toBe(
      "efdd2f85036800273afb778dec26c208a874490c4acb53afdbeeeb24668a9133",
    );
  });

  test("the director is v11 and its system prompt is pinned", () => {
    expect(PICTURE_DIRECTOR_VERSION).toBe("picture-director.v11");
    const { system } = pictureDirectorPrompt({ aspect: 1, mustShow: [] } as never);
    expect(sha(system)).toBe(DIRECTOR_SYSTEM_SHA);
  });

  test("the photo judge is v17 and its system prompt is pinned", () => {
    expect(pickOrRequeryPrompt.version).toBe("pick-or-requery-photo.v17");
    expect(sha(pickOrRequeryPrompt.system)).toBe(JUDGE_SYSTEM_SHA);
  });
});

const DIRECTOR_SYSTEM_SHA = "3d4e3ccb1f5d7ca2bb5fcc10d99e1a5625e39543e114f05bf3e5cd6016de591d";
const JUDGE_SYSTEM_SHA = "b56d123687d97c8572a236402effe13d0e7b446ddcf25b9f2b4b30e2bc0cd395";

/**
 * Independent of the modules above: the lab's own files at base4 (lab/ab 92f1b36d), checked
 * against the lab's PINS.json hashes, and the system texts the lab modules rendered from them.
 */
describe("base4 lab pins (not circular)", () => {
  const dir = join(import.meta.dir, "base4-pins");
  const read = (f: string) => readFileSync(join(dir, f), "utf8");
  const manifest = JSON.parse(read("PINS.base4.json")) as {
    labPins: Record<string, string>;
    files: Record<string, string>;
  };

  test("each copied lab file has the lab's PINS.json hash", () => {
    for (const [file, pin] of Object.entries(manifest.files))
      expect(sha(read(file))).toBe(manifest.labPins[pin] as string);
  });

  test("the director v11, judge v17 and batch prompts equal the lab's rendered texts", () => {
    const { system } = pictureDirectorPrompt({ aspect: 1, mustShow: [] } as never);
    expect(system).toBe(read("picture-director.v11.system.txt"));
    expect(pickOrRequeryPrompt.system).toBe(read("pick-or-requery-photo.v17.system.txt"));
    expect(PICTURE_DIRECTOR_BATCH_SYSTEM).toBe(read("director-batch.base4.txt"));
  });

  test("the lab sources are the versions pinned", () => {
    expect(read("picture-director.v11.lab-source.txt")).toContain('"picture-director.v11"');
    expect(read("pick-or-requery-photo.v17.lab-source.txt")).toContain(
      '"pick-or-requery-photo.v17"',
    );
  });
});
