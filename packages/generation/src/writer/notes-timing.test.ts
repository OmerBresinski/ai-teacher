import { describe, expect, test } from "bun:test";
import type { VisualAsk, VisualState } from "./materialise";
import { recordedVisuals, replayRun, replayServices } from "./replay-fixture";
import type { ChatReq, WriterServices } from "./services";

/**
 * The speaker notes start at stream end, beside the pictures, not after the deck is editable
 * (gen-health audit, 26 Oct: a ~22 s notes call ran after the last picture and added ~20 s to job
 * end). The real stage on a saved run; only the model and the picture timing are replaced.
 */
const FIXTURE = "y1-science-animals-young-r2";
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
const only = (r: { user: string }) => r.user.match(/slides only: (\d+)\.$/);
/** The slide numbers the one-slide redo calls were for. */
const redoneIn = (calls: { user: string }[]) =>
  [...new Set(calls.flatMap((c) => (only(c) ? [Number(only(c)?.[1])] : [])))].sort((a, b) => a - b);

/** Pictures settle `picMs` after the stream; the deck-wide notes call takes `notesMs`. */
function timed(picMs: number, notesMs: number, visual0 = recordedVisuals(FIXTURE)) {
  const base = replayServices(FIXTURE);
  const t0 = performance.now();
  const at = () => performance.now() - t0;
  const marks: Record<string, number> = {};
  const calls: { user: string; start: number; end: number }[] = [];
  let settled = false;
  const services: WriterServices = {
    ...base,
    chat: async (r: ChatReq) => {
      if (r.name !== "notes") {
        await tick(2);
        return base.chat(r);
      }
      const c = { user: r.user, start: at(), end: -1 };
      calls.push(c);
      await tick(only(r) ? 5 : notesMs);
      c.end = at();
      const n = Number(only(r)?.[1] ?? 0);
      return {
        out: {
          slides: Array.from({ length: 20 }, (_, k) => ({
            n: k + 1,
            answers: null,
            misconceptions: null,
            background: n ? `REDONE ${n}` : `DECK ${k + 1}`,
            run: null,
          })).filter((s) => !n || s.n === n),
        },
        usd: 0,
        ms: 0,
      };
    },
  };
  // A picture is pending until the pictures settle, then lands as recorded.
  const visual = (i: number, key: string, a: VisualAsk): VisualState =>
    settled || a.type !== "photo" ? visual0(i, key, a) : { status: "pending" };
  const hooks = {
    beforeEditable: async () => {
      marks.picturesFrom = at();
      await tick(picMs);
      settled = true;
      marks.picturesDone = at();
    },
    onEditable: async () => {
      marks.editable = at();
    },
  };
  const go = async (s: WriterServices = services) => {
    const out = await replayRun(FIXTURE, { services: s, visual, hooks });
    marks.end = at();
    return out;
  };
  return { services, calls, marks, go };
}

describe("speaker notes start at stream end, beside the pictures", () => {
  test("the deck-wide notes call starts before the pictures settle and the deck is editable", async () => {
    const t = timed(150, 100);
    await t.go();
    const deck = t.calls.find((c) => !/slides only/.test(c.user));
    expect(deck).toBeDefined();
    expect(deck?.start ?? Infinity).toBeLessThanOrEqual(t.marks.picturesFrom ?? -1);
    expect(deck?.start ?? Infinity).toBeLessThan(t.marks.editable ?? -1);
  });

  test("job end does not wait on notes when pictures take longer than notes", async () => {
    const notesMs = 300;
    const t = timed(400, notesMs);
    await t.go();
    const deck = t.calls.find((c) => !/slides only/.test(c.user));
    // The notes finished while the pictures were still loading ...
    expect(deck?.end ?? Infinity).toBeLessThan(t.marks.picturesDone ?? -1);
    // ... so the job ends well under one notes call after the last picture (it used to be
    // pictures, then the whole notes call: picturesDone + notesMs at least).
    expect((t.marks.end ?? 0) - (t.marks.picturesDone ?? 0)).toBeLessThan(notesMs / 2);
  });

  test("a picture that lands as asked costs no notes redo; the deck-wide note stays", async () => {
    const t = timed(30, 10);
    const out = await t.go();
    const redone = new Set(redoneIn(t.calls));
    const pictured = out.slides.filter(
      (s) =>
        Number(s.id.match(/^s(\d+)$/)?.[1]) > 2 &&
        (s.elements as { type?: string; src?: string }[]).some(
          (e) => e.type === "image" && e.src && !String(e.src).startsWith("data:"),
        ),
    );
    expect(pictured.length).toBeGreaterThan(0);
    // Every picture went from pending (what the notes call saw) to landed: none of those slides
    // is redone for its picture alone; any redo is for words a repair changed.
    for (const s of pictured) {
      const n = Number(s.id.match(/^s(\d+)$/)?.[1]);
      if (!n || redone.has(n)) continue;
      expect(s.notes).toContain(`DECK ${n}`);
    }
    // Same redos as a run whose pictures were all in before the notes started (the old order).
    const landedFirst = timed(0, 10);
    const v = recordedVisuals(FIXTURE);
    await replayRun(FIXTURE, { services: landedFirst.services, visual: v });
    expect(redoneIn(landedFirst.calls)).toEqual([...redone].sort((a, b) => a - b));
  });

  test("a picture lost after the notes call saw it asked gets that slide's note written again", async () => {
    const rec = recordedVisuals(FIXTURE);
    // Find a slide with a recorded photo; that photo fails instead once the pictures settle.
    const first = timed(10, 10);
    const base = await first.go();
    const victim = base.slides.find(
      (s) =>
        Number(s.id.match(/^s(\d+)$/)?.[1]) > 2 &&
        (s.elements as { type?: string; src?: string }[]).some(
          (e) => e.type === "image" && e.src && !String(e.src).startsWith("data:"),
        ),
    );
    const vi = Number(victim?.id.match(/^s(\d+)$/)?.[1]) - 1;
    expect(vi).toBeGreaterThanOrEqual(2);
    const lose = Object.assign(
      (i: number, key: string, a: VisualAsk): VisualState =>
        i === vi && a.type === "photo" ? { status: "failed" } : rec(i, key, a),
      { placeMore: rec.placeMore },
    );
    const t = timed(30, 10, lose);
    const out = await t.go();
    const redo = t.calls.find((c) => only(c)?.[1] === String(vi + 1));
    expect(redo).toBeDefined();
    // The redo saw the slide without its picture, and the slide ships the redo's note.
    expect(redo?.start ?? -1).toBeGreaterThanOrEqual(t.marks.picturesDone ?? Infinity);
    expect(out.slides.find((s) => s.id === `s${vi + 1}`)?.notes).toContain(`REDONE ${vi + 1}`);
  });
});
