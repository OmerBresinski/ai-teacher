import { describe, expect, test } from "bun:test";
import { packOwnBundleId, resolveWriterBundleId, WRITER_BUNDLE_ID, WRITER_BUNDLES } from "./bundle";
import { PACK_WRITER_BUNDLE } from "./pilot-live";
import { PILOT_PACK_LIVE, PILOT_PACKS } from "./pilot-pack";

/*
 * Pilot pack v5.2-gold (12 Nov 2026, scratchpad/tuning/v5.2-gold): v5.1b-gold's switches with six
 * drafted line edits in each system template, and writer bundle base4f-p127 (the pitch floor) for
 * its objectives, user turn and notes. Lab only: the live pack and the shipped bundle are as before.
 */

const KS: ("KS1" | "KS2" | "KS3")[] = ["KS1", "KS2", "KS3"];
/** The drafted edits (CHANGES.md 2a, 3a, 3b, 4a, 4b, 4c), each applied once to v5.1b-gold's text as sent. */
const EDITS: [string, string][] = [
  [
    "- Is short: the fewest slides that teach and check every objective, near the low end of the context's range.\n",
    "",
  ],
  [
    "it opens on what pupils know or a question worth answering",
    "it opens on what the context says pupils already know or a question worth answering",
  ],
  [
    "Facts come from the curriculum extract or a standard reference, as pupils of this age are taught them, and people go by the names pupils are taught.",
    "Facts come from a standard reference, as pupils of this age are taught them, and people go by the names pupils are taught. A sentence claims only what happened: an attempt or a usual case is worded as one.",
  ],
  [
    "A question asks one clear, whole question, what it needs inside it. It states every fact and number its answer needs, even when its picture shows them, and uses only what this lesson taught or pupils of this age know. Its answer is in the words of an earlier slide, never only in a picture.",
    "A question asks one clear, whole question. It states every fact and number its answer needs, even when its picture shows them. Each step and reason its answer needs is shown on an earlier slide; its facts are from those slides or what the context says pupils already know, never only a picture. A why or explain question is answered with the taught reason, never itself restated.",
  ],
  [
    "up to its fit's questions, joining two objectives in one question only when it must.",
    "up to its fit's questions. With more objectives than questions, each still asks about one: those practice checked least.",
  ],
  [
    "then the line it gives, with answer true on the row that reaches the answer.",
    "then the line it gives; answer is true on the last row, whose own line reaches the answer, and no row only restates it.",
  ],
];

describe("v5.2-gold system text", () => {
  test.each(KS)("%s: v5.1b-gold's text as sent with exactly the six drafted edits", (ks) => {
    let text = PILOT_PACKS["v5.1b-gold"].system[ks];
    for (const [from, to] of EDITS) {
      expect(text.split(from).length - 1).toBe(1);
      text = text.replace(from, to);
    }
    expect(PILOT_PACKS["v5.2-gold"].system[ks]).toBe(text);
  });
  test.each(KS)("%s: every slot filled; every number (each limit) as in v5.1b-gold", (ks) => {
    const a = PILOT_PACKS["v5.1b-gold"].system[ks];
    const b = PILOT_PACKS["v5.2-gold"].system[ks];
    expect(b).not.toContain("{{");
    const nums = (t: string) => (t.match(/\d+/g) ?? []).sort().join(" ");
    expect(nums(b)).toBe(nums(a));
  });
  test("the switches are v5.1b-gold's", () => {
    const { id: _a, system: _s, ...a } = PILOT_PACKS["v5.1b-gold"];
    const { id: _b, system: _t, ...b } = PILOT_PACKS["v5.2-gold"];
    expect(b).toEqual(a);
  });
});

describe("v5.2-gold runs writer bundle base4f-p127", () => {
  test("the pack names it; other packs run the active bundle", () => {
    expect(PACK_WRITER_BUNDLE["v5.2-gold"]).toBe("base4f-p127");
    expect(packOwnBundleId("v5.2-gold")).toBe("base4f-p127");
    expect(packOwnBundleId("v5.1b-gold")).toBeUndefined();
    expect(packOwnBundleId(undefined)).toBeUndefined();
    for (const pack of Object.keys(PACK_WRITER_BUNDLE)) expect(pack in PILOT_PACKS).toBe(true);
  });
  test("TJ_PILOT_PACK=v5.2-gold selects it; unset, the live pack's bundle; the lab override wins", () => {
    const quiet = () => {};
    expect(resolveWriterBundleId({ TJ_PILOT_PACK: "v5.2-gold" }, quiet)).toBe("base4f-p127");
    expect(resolveWriterBundleId({}, quiet)).toBe(WRITER_BUNDLE_ID);
    expect(resolveWriterBundleId({ TJ_PILOT_PACK: "v5.1b-gold" }, quiet)).toBe(WRITER_BUNDLE_ID);
    expect(
      resolveWriterBundleId(
        { TJ_PILOT_PACK: "v5.2-gold", LAB_PARITY: "1", LAB_WRITER_BUNDLE_ID: "base4f-p125" },
        quiet,
      ),
    ).toBe("base4f-p125");
  });
  test("nothing live moved", () => {
    expect(PILOT_PACK_LIVE).toBe("v5.0b");
    expect(WRITER_BUNDLE_ID).toBe("base4f-p126");
  });
  test("p127 is p126 with five files replaced and the pitch floor on", () => {
    const a = WRITER_BUNDLES["base4f-p126"] as unknown as Record<string, unknown>;
    const b = WRITER_BUNDLES["base4f-p127"] as unknown as Record<string, unknown>;
    const changed = ["objectives", "objectivesUser", "objectivesSchema", "user", "notes"];
    for (const k of Object.keys(a)) {
      if (k === "id" || k === "pins" || k === "features") continue;
      if (changed.includes(k)) expect(b[k]).not.toEqual(a[k]);
      else expect(b[k]).toEqual(a[k]);
    }
    expect(WRITER_BUNDLES["base4f-p127"].features).toEqual({ pitchFloor: true });
    expect(JSON.parse(WRITER_BUNDLES["base4f-p127"].objectivesSchema).required).toEqual([
      "builds_on",
      "objectives",
    ]);
    expect(WRITER_BUNDLES["base4f-p127"].notes).not.toContain("minutes");
  });
});
