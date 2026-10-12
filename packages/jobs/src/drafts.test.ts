import { describe, expect, test } from "bun:test";
import type { SlideDraftPayload } from "@tj/domain";
import { createDraftEmitter } from "./drafts";

/* Live writing (ADR 0039): the worker's slide-draft throttle. */

const draft = (index: number, words: string, final = false): SlideDraftPayload => ({
  index,
  slideId: `s${index + 1}`,
  slide: { id: `s${index + 1}`, kind: "content", elements: [], notes: words },
  ...(final ? { final } : {}),
});

function harness() {
  let clock = 1_000;
  const emitted: SlideDraftPayload[] = [];
  const emitter = createDraftEmitter({
    minIntervalMs: 20,
    now: () => clock,
    emit: async (d) => {
      emitted.push(d);
    },
    onError: (err) => {
      throw err;
    },
  });
  return { emitter, emitted, tick: (ms: number) => (clock += ms) };
}
const settle = () => new Promise((r) => setTimeout(r, 40));
const said = (ds: SlideDraftPayload[]) => ds.map((d) => `${d.index}:${d.slide.notes}`);

describe("createDraftEmitter", () => {
  test("the first draft goes at once; inside the window only the newest per slide goes", async () => {
    const { emitter, emitted } = harness();
    emitter.emit(draft(2, "a"));
    emitter.emit(draft(2, "a b"));
    emitter.emit(draft(2, "a b c"));
    await settle();
    expect(said(emitted)).toEqual(["2:a", "2:a b c"]);
  });

  test("a burst is written in slide order, and a final draft is never replaced by words", async () => {
    const { emitter, emitted } = harness();
    emitter.emit(draft(2, "x"));
    emitter.emit(draft(3, "y"));
    emitter.emit(draft(2, "done", true));
    emitter.emit(draft(2, "late words"));
    await settle();
    expect(said(emitted)).toEqual(["2:x", "2:done", "3:y"]);
    expect(emitted[1]?.final).toBe(true);
  });

  test("stop drops what is pending and takes no more", async () => {
    const { emitter, emitted } = harness();
    emitter.emit(draft(2, "a"));
    emitter.emit(draft(2, "pending"));
    await emitter.stop();
    emitter.emit(draft(4, "after"));
    await settle();
    expect(said(emitted)).toEqual(["2:a"]);
  });

  test("a failed write is reported and the next draft carries on", async () => {
    const errors: unknown[] = [];
    let n = 0;
    const emitter = createDraftEmitter({
      minIntervalMs: 0,
      emit: async () => {
        n++;
        if (n === 1) throw new Error("db down");
      },
      onError: (e) => errors.push(e),
    });
    emitter.emit(draft(2, "a"));
    emitter.emit(draft(2, "b"));
    await emitter.stop();
    expect(errors.length).toBe(1);
    expect(n).toBe(2);
  });
});
