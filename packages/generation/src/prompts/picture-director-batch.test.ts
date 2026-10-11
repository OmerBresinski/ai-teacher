import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pickOrRequeryPrompt } from "./pick-or-requery-photo-directed";
import { PICTURE_DIRECTOR_VERSION, pictureDirectorPrompt } from "./picture-director";
import { PICTURE_DIRECTOR_BATCH_SYSTEM } from "./picture-director-batch";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * The pins: the director (v12), its batched prompt (v2) and the photo judge (v17) as the writer planner
 * ships them. A wording change bumps the version and this hash in the same commit.
 */
describe("picture prompt pins", () => {
  test("the batched director prompt is the pinned file, byte for byte", () => {
    expect(sha(PICTURE_DIRECTOR_BATCH_SYSTEM)).toBe(
      "a262bf329669cf0073d772c6908d51edd649a3107925f5496e4615f68efe3ec4",
    );
  });

  test("the director is v12 and its system prompt is pinned", () => {
    expect(PICTURE_DIRECTOR_VERSION).toBe("picture-director.v12");
    const { system } = pictureDirectorPrompt({ aspect: 1, mustShow: [] } as never);
    expect(sha(system)).toBe(DIRECTOR_SYSTEM_SHA);
  });

  test("the photo judge is v17 and its system prompt is pinned", () => {
    expect(pickOrRequeryPrompt.version).toBe("pick-or-requery-photo.v17");
    expect(sha(pickOrRequeryPrompt.system)).toBe(JUDGE_SYSTEM_SHA);
  });
});

/**
 * v12 (heart R3, UX rulings on picture age): a child in the picture is the pupils' age (the lesson
 * line now carries it), with trims so the prompt is no longer than v11. The batch prompt shares them.
 */
const DIRECTOR_EDITS: [string, string][] = [
  [
    "In a photo lesson it is one realistic photograph, and living subjects look natural and unposed, as in a real photograph.",
    "In a photo lesson it is one realistic photograph, living subjects natural and unposed.",
  ],
  [
    "are the same breed or variety with the same colouring, both whole and neither crowding the other out.",
    "are the same breed or variety and colouring, both whole and neither crowding the other out. A child in it is the pupils' age, in years, unless the slide is about another age.",
  ],
  [
    "it shows the real thing as it truly looks or looked.",
    "it shows the real thing as it looks or looked.",
  ],
  [
    "since the image model draws every object a prompt mentions, and describe what is there rather than what to leave out.",
    "since the image model draws every object named, and describe what is there, not what to leave out.",
  ],
  [
    "Code adds the rules about text and a single frame.",
    "Code adds the text and single-frame rules.",
  ],
  ["on a plain, uncluttered background", "on a plain background"],
  ["and a generated one is only the fallback.", "and generation is the fallback."],
  [
    "a painted educational illustration of the scene, never a photograph.",
    "a painted educational illustration, never a photograph.",
  ],
];

const DIRECTOR_SYSTEM_SHA = "130404d52cbcc36a15800663fcebad07bccebcf7e6e262286eaab4e248cce29d";
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

  test("the director v12 and batch v2 are the lab's texts plus only the listed edits; judge v17 equal", () => {
    const edited = (t: string) => {
      for (const [from, to] of DIRECTOR_EDITS) {
        expect(t.split(from).length).toBe(2);
        t = t.replace(from, to);
      }
      return t;
    };
    const { system } = pictureDirectorPrompt({ aspect: 1, mustShow: [] } as never);
    expect(system).toBe(edited(read("picture-director.v11.system.txt")));
    expect(pickOrRequeryPrompt.system).toBe(read("pick-or-requery-photo.v17.system.txt"));
    expect(PICTURE_DIRECTOR_BATCH_SYSTEM).toBe(edited(read("director-batch.base4.txt")));
    expect(system.length).toBeLessThan(read("picture-director.v11.system.txt").length);
  });

  test("the lab sources are the versions pinned", () => {
    expect(read("picture-director.v11.lab-source.txt")).toContain('"picture-director.v11"');
    expect(read("pick-or-requery-photo.v17.lab-source.txt")).toContain(
      '"pick-or-requery-photo.v17"',
    );
  });
});
