import { describe, expect, test } from "bun:test";
import type { Lesson } from "@tj/domain/documents";
import { WRITER_VERSION } from "../writer/ai-services";
import { packOwnBundleId, WRITER_BUNDLES, type WriterBundleId } from "../writer/bundle";
import { PACK_WRITER_BUNDLE } from "../writer/pilot-live";
import { PILOT_PACK_ID, PILOT_PACKS, type PilotPackId } from "../writer/pilot-pack";
import { runBundle } from "../writer/stage";
import { stampedPack, WRITER_PLANNED_VERSION } from "./objectives-first";
import { writerPackOf } from "./write";

/*
 * A stale bundle stamp (REVIEW-pipeline MAJOR 2.2): a lesson planned under one pack and written
 * after the live pack changed must never pair the new pack's flow schema with the old bundle's
 * user turn, nor keep old-pack slides beside new-pack ones.
 */

const stamp = (bundle: string, pack?: string) =>
  `${WRITER_VERSION}+writer-objectives+bundle-${bundle}${pack ? `+pilot-${pack}` : ""}`;
const lesson = (planned: string, generated?: string) =>
  ({
    id: "l1",
    generation: {
      stage: "planned",
      promptVersions: { planned, ...(generated ? { generated } : {}) },
    },
  }) as unknown as Lesson;
const owned = new Set(Object.values(PACK_WRITER_BUNDLE));
/** A pack and bundle belong together: the pack's own bundle, or a shared one for a pack with none. */
const paired = (pack: PilotPackId, bundle: WriterBundleId) => {
  const own = packOwnBundleId(pack);
  return own === undefined ? !owned.has(bundle) : own === bundle;
};

describe("a lesson's pack and bundle (writerPackOf)", () => {
  test("planned on p126 before the switch, written after it: finishes on v5.0b, not gold", () => {
    const r = writerPackOf(lesson(stamp("base4f-p126")), "v5.3-gold");
    expect(r).toEqual({ pack: "v5.0b", bundle: "base4f-p126", rule: 5 });
  });
  test("half written under v5.0b (generated stamp) when gold went live: keeps v5.0b", () => {
    const r = writerPackOf(
      lesson(stamp("base4f-p126"), `${WRITER_VERSION}+bundle-base4f-p126+pilot-v5.0b`),
      "v5.3-gold",
    );
    expect(r).toMatchObject({ pack: "v5.0b", bundle: "base4f-p126", rule: 2 });
  });
  test("planned under gold, live reverted to v5.0b: finishes on gold with its own bundle", () => {
    expect(writerPackOf(lesson(stamp("base4f-p128", "v5.3-gold")), "v5.0b")).toEqual({
      pack: "v5.3-gold",
      bundle: "base4f-p128",
      rule: 1,
    });
    // An unstamped gold bundle finds its owner.
    expect(writerPackOf(lesson(stamp("base4f-p128")), "v5.0b")).toMatchObject({
      pack: "v5.3-gold",
      rule: 4,
    });
  });
  test("a stamp matching the live pack runs the live pack", () => {
    expect(writerPackOf(lesson(stamp("base4f-p126")), "v5.0b").pack).toBe("v5.0b");
    expect(writerPackOf(lesson(stamp("base4f-p128")), "v5.3-gold")).toMatchObject({
      pack: "v5.3-gold",
      rule: 3,
    });
  });
  test("a stamped pack that no longer exists falls through to the bundle rules", () => {
    expect(writerPackOf(lesson(stamp("base4f-p128", "v9-gone")), "v5.0b").pack).toBe("v5.3-gold");
  });
  test("every live pack x every unstamped bundle gives a matching pair", () => {
    for (const live of Object.keys(PILOT_PACKS) as PilotPackId[])
      for (const b of Object.keys(WRITER_BUNDLES) as WriterBundleId[]) {
        const r = writerPackOf(lesson(stamp(b)), live);
        expect({ live, b, ok: paired(r.pack, r.bundle) }).toEqual({ live, b, ok: true });
      }
  });
  test("new plans record the pack they were planned for", () => {
    expect(stampedPack(WRITER_PLANNED_VERSION)).toBe(PILOT_PACK_ID);
    expect(writerPackOf(lesson(WRITER_PLANNED_VERSION)).pack).toBe(PILOT_PACK_ID);
  });
});

describe("the stage's backstop (runBundle)", () => {
  test("a gold pack handed a p126 stamp runs its own bundle and logs it", () => {
    const seen: Record<string, unknown>[] = [];
    expect(runBundle({ pilotPack: "v5.3-gold", bundle: "base4f-p126" }, (e) => seen.push(e))).toBe(
      "base4f-p128",
    );
    expect(seen).toEqual([
      { ev: "bundle-mismatch", pack: "v5.3-gold", stamped: "base4f-p126", runs: "base4f-p128" },
    ]);
  });
  test("a pack with no bundle of its own keeps the run's bundle", () => {
    expect(runBundle({ pilotPack: "v5.0b", bundle: "base4f-p126" })).toBe("base4f-p126");
    expect(runBundle({ pilotPack: "v5.3-gold" })).toBe("base4f-p128");
  });
});
