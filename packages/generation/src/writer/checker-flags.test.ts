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
