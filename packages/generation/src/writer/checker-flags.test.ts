import { describe, expect, test } from "bun:test";
import { type CheckerFlags, parseCheckerFlags } from "./checker-flags";
import { recordedVisuals, replayRun, replayServices } from "./replay-fixture";

/*
 * The checker's flags (CHECKER-AUDIT, 9 Oct 2026), each alone against the pinned writer outputs
 * (fixtures/replay, recorded repair answers, no model call). Flags off is master's checker: the
 * parity tests (replay.test.ts) hold it.
 */
type Ev = Record<string, unknown>;
async function run(
  b: string,
  checker: CheckerFlags,
  visual?: Parameters<typeof replayRun>[1]["visual"],
) {
  const events: Ev[] = [];
  const calls: string[] = [];
  const base = replayServices(b);
  const res = await replayRun(b, {
    checker,
    ...(visual ? { visual } : {}),
    services: {
      ...base,
      log: (e) => events.push(e as Ev),
      chat: (r) => {
        calls.push(r.name);
        return base.chat(r);
      },
    },
  });
  const images = res.slides.map((s) => s.elements.filter((e) => e.type === "image").length);
  const pathOf = (slide: number) =>
    events.find((e) => e.ev === "visual-path" && e.slide === slide)?.path as string | undefined;
  return { res, events, calls, images, pathOf };
}

describe("parseCheckerFlags", () => {
  test("reads a comma list and refuses an unknown name", () => {
    expect(parseCheckerFlags(" duplicateLogOnly,pointGuardLogOnly ")).toEqual({
      duplicateLogOnly: true,
      pointGuardLogOnly: true,
    });
    expect(parseCheckerFlags(undefined)).toEqual({});
    expect(() => parseCheckerFlags("duplicateLogOnly,nope")).toThrow('unknown checker flag "nope"');
  });
});

describe("fallbackOnlyOnFailure", () => {
  test("y12 s4 and s7: a drawn flow that did not fit beside the words is shown full width, not rewritten", async () => {
    const off = await run("y12-psychology-multi-store-model", {});
    const on = await run("y12-psychology-multi-store-model", { fallbackOnlyOnFailure: true });
    expect([off.pathOf(4), off.pathOf(7)]).toEqual(["words-rewrite", "words-rewrite"]);
    expect([off.images[3], off.images[6]]).toEqual([0, 0]);
    expect([on.pathOf(4), on.pathOf(7)]).toEqual(["diagram-big", "diagram-big"]);
    expect([on.images[3], on.images[6]]).toEqual([1, 1]);
    // The points the full-width layout has no room for are read in the notes, never lost.
    expect(on.res.slides[3]?.notes).toContain("Moved off the slide to fit the diagram:");
    expect(on.res.slides[3]?.notes).toContain(
      "Retrieval brings stored information from LTM to STM.",
    );
    expect(on.calls.filter((c) => c === "slide").length).toBeLessThan(
      off.calls.filter((c) => c === "slide").length,
    );
  });
  test("y11 s3: a drawing with a real readability fault still takes the fallback chain", async () => {
    const on = await run("y11-chemistry-rates-of-reaction", { fallbackOnlyOnFailure: true });
    expect(on.events).toContainEqual(
      expect.objectContaining({ ev: "diagram-relaid", slide: 3, ok: false }),
    );
    expect(on.pathOf(3)).toBe("picture");
  });
});

describe("fixTableToText", () => {
  // y10 (teacher-path proof-master-writer, signed in) s3 shipped "Formed 1882: Members:
  // Austria-Hungary" from a table whose first column groups rows; y12 s3's table, forced to fail
  // here, is the same path.
  // The recorded table, grown to 40 rows so no layout can place it (as y10's could not).
  const failS3 = (b: string) => {
    const rec = recordedVisuals(b);
    return (i: number, key: string, a: Parameters<typeof rec>[2]) => {
      const v = rec(i, key, a);
      if (i !== 2 || v.status !== "diagram") return v;
      const spec = v.spec as { rows: string[][] };
      return { ...v, spec: { ...spec, rows: Array.from({ length: 10 }, () => spec.rows).flat() } };
    };
  };
  test("a table that cannot be shown is never rebuilt as label: value rows", async () => {
    const b = "y12-psychology-multi-store-model";
    const off = await run(b, {}, failS3(b));
    const on = await run(b, { fixTableToText: true }, failS3(b));
    expect(off.pathOf(3)).toBe("table-text");
    expect(on.pathOf(3)).not.toBe("table-text");
  });
});
