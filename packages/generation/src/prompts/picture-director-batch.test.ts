import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pickOrRequeryPrompt } from "./pick-or-requery-photo-directed";
import { PICTURE_DIRECTOR_VERSION, pictureDirectorPrompt } from "./picture-director";
import { PICTURE_DIRECTOR_BATCH_SYSTEM } from "./picture-director-batch";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * The pins: the director (v12), its batched prompt (v2) and the photo judge (v19) as the writer planner
 * ships them. A wording change bumps the version and this hash in the same commit.
 */
describe("picture prompt pins", () => {
  test("the batched director prompt is the pinned file, byte for byte", () => {
    expect(sha(PICTURE_DIRECTOR_BATCH_SYSTEM)).toBe(
      "30be0019783de5af1db4a1a64cb9c7ae0bd38649338f0e6bb7d703b4070bc527",
    );
  });

  test("the director is v12 and its system prompt is pinned", () => {
    expect(PICTURE_DIRECTOR_VERSION).toBe("picture-director.v12");
    const { system } = pictureDirectorPrompt({ aspect: 1, mustShow: [] } as never);
    expect(sha(system)).toBe(DIRECTOR_SYSTEM_SHA);
  });

  // v18 added the painted-picture rules in the user turn (TEACH-251 part x); v19 adds the
  // lesson-language rule for writing in the picture to `fits` (TEACH-251 part al).
  test("the photo judge is v19 and its system prompt is pinned", () => {
    expect(pickOrRequeryPrompt.version).toBe("pick-or-requery-photo.v19");
    expect(sha(pickOrRequeryPrompt.system)).toBe(JUDGE_SYSTEM_SHA);
  });
});

/**
 * v12 (heart R3; production scope is these lines only): a child in the picture is the pupils' age
 * (the lesson line carries it), and the subject sits whole inside the frame with a margin
 * (TEACH-251 part f: an arm ran off the edge), large rather than frame-filling. The batch shares them.
 */
const DIRECTOR_EDITS: [string, string][] = [
  [
    "both whole and neither crowding the other out.",
    "both whole and neither crowding the other out. A child in it is the pupils' age, in years, unless the slide is about another age.",
  ],
  [
    "Frame it for the zone's shape.",
    "Frame it for the zone's shape, the subject whole inside the frame with a margin.",
  ],
  [
    "the few the slide needs, filling the frame on a plain",
    "the few the slide needs, large on a plain",
  ],
];

const DIRECTOR_SYSTEM_SHA = "e6006c679ac6f6f881bdc4bf5fe7280c626f46d502509a51e1e6192c0e1f70c3";
const JUDGE_SYSTEM_SHA = "7dc9bfe4dc6a4e0e3b8ecae821f7c7b7897529bc2eca990a792337a6006ffca2";

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

  test("the director v12 and batch v2 are the lab's texts plus only the listed edits; judge v17 plus v19's sentences", () => {
    const edited = (t: string) => {
      for (const [from, to] of DIRECTOR_EDITS) {
        expect(t.split(from).length).toBe(2);
        t = t.replace(from, to);
      }
      return t;
    };
    const { system } = pictureDirectorPrompt({ aspect: 1, mustShow: [] } as never);
    expect(system).toBe(edited(read("picture-director.v11.system.txt")));
    // v19 (TEACH-251 part al) inserts the lesson-language rule into `fits` and changes nothing else.
    const v19 = pickOrRequeryPrompt.system;
    const from = v19.indexOf(" Writing meant to be read in the picture");
    const to = v19.indexOf(" A pick with `fits` false is never used.", from);
    expect(from).toBeGreaterThan(0);
    expect(v19.slice(0, from) + v19.slice(to)).toBe(read("pick-or-requery-photo.v17.system.txt"));
    expect(PICTURE_DIRECTOR_BATCH_SYSTEM).toBe(edited(read("director-batch.base4.txt")));
  });

  test("the lab sources are the versions pinned", () => {
    expect(read("picture-director.v11.lab-source.txt")).toContain('"picture-director.v11"');
    expect(read("pick-or-requery-photo.v17.lab-source.txt")).toContain(
      '"pick-or-requery-photo.v17"',
    );
  });
});
