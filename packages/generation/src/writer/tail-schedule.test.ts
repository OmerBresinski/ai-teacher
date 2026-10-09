import { describe, expect, test } from "bun:test";
import { replayRun, replayServices } from "./replay-fixture";
import { eachBounded, TAIL_CONCURRENCY } from "./schedule";
import type { ChatReq, WriterServices } from "./services";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("eachBounded", () => {
  test("runs at most `limit` at once and starts each item as soon as a lane is free", async () => {
    let live = 0;
    let most = 0;
    const started: number[] = [];
    // Item 0 is slow: items 1..4 still run through the other lane instead of waiting behind it.
    await eachBounded([40, 5, 5, 5, 5], 2, async (ms, k) => {
      started.push(k);
      live++;
      most = Math.max(most, live);
      await tick(ms);
      live--;
    });
    expect(most).toBe(2);
    expect(started).toEqual([0, 1, 2, 3, 4]);
  });

  test("a failure starts no new item and rejects once the running ones have finished", async () => {
    const done: number[] = [];
    const boom = new Error("boom");
    const run = eachBounded([0, 1, 2, 3], 2, async (k) => {
      if (k === 0) throw boom;
      await tick(10);
      done.push(k);
    });
    await expect(run).rejects.toBe(boom);
    // Item 1 was running when item 0 failed and finished; 2 and 3 never started.
    expect(done).toEqual([1]);
  });
});

/**
 * The real stage (`runWriter`), its real checks, repair calls and notes merge, on a saved run with
 * seven recorded repair answers. Only the model is replaced: each recorded answer is returned after
 * a delay, so the order the stage makes its calls in is visible.
 */
const FIXTURE = "y1-science-animals-young";
type Call = { name: string; user: string; start: number; end: number };

function timedServices(redo: (n: number) => unknown, deck?: () => unknown) {
  const base = replayServices(FIXTURE);
  const calls: Call[] = [];
  let clock = 0;
  let live = 0;
  let most = 0;
  const services: WriterServices = {
    ...base,
    chat: async (r: ChatReq) => {
      const call: Call = { name: String(r.name), user: r.user, start: clock++, end: -1 };
      calls.push(call);
      const only = r.name === "notes" ? r.user.match(/slides only: (\d+)\.$/) : null;
      if (r.name === "slide") most = Math.max(most, ++live);
      // Repairs take 20 ms each; the deck-wide notes call takes longer than all of them together.
      await tick(r.name === "slide" ? 20 : r.name === "notes" && !only ? 200 : 5);
      if (r.name === "slide") live--;
      call.end = clock++;
      if (only) return { out: redo(Number(only[1])), usd: 0, ms: 0 };
      if (r.name === "notes" && deck) return { out: deck(), usd: 0, ms: 0 };
      return base.chat(r);
    },
  };
  return { services, calls, most: () => most };
}

describe("the writer's tail: parallel repairs, notes beside them", () => {
  test("failing slides are repaired in parallel, bounded, by the real repair path", async () => {
    const t = timedServices(() => ({ slides: [] }));
    await replayRun(FIXTURE, { services: t.services });
    const repairs = t.calls.filter((c) => c.name === "slide");
    expect(repairs.length).toBeGreaterThanOrEqual(2);
    // On master these ran one at a time (`for (const c of failing) await fitLoop(c)`): at most 1.
    expect(t.most()).toBeGreaterThanOrEqual(2);
    expect(t.most()).toBeLessThanOrEqual(TAIL_CONCURRENCY);
  });

  test("the deck-wide notes call starts before the repairs end, not after them", async () => {
    const t = timedServices(() => ({ slides: [] }));
    await replayRun(FIXTURE, { services: t.services });
    const deckNotes = t.calls.find((c) => c.name === "notes" && !/slides only/.test(c.user));
    const lastRepairEnd = Math.max(...t.calls.filter((c) => c.name === "slide").map((c) => c.end));
    expect(deckNotes).toBeDefined();
    expect(deckNotes?.start).toBeLessThan(lastRepairEnd);
  });

  test("a slide whose words changed after the notes call saw it gets its note written again", async () => {
    const t = timedServices((n) => ({
      slides: [
        { n, answers: null, misconceptions: null, background: `REDONE ${n}`, run: null },
        // A row for another slide is ignored: the call was asked for slide n only.
        { n: n + 100, answers: null, misconceptions: null, background: "STRAY", run: null },
      ],
    }));
    const out = await replayRun(FIXTURE, { services: t.services });
    const redos = t.calls.filter((c) => c.name === "notes" && /slides only/.test(c.user));
    expect(redos.length).toBeGreaterThan(0);
    for (const r of redos) {
      const n = Number(r.user.match(/slides only: (\d+)\.$/)?.[1]);
      const slide = out.slides.find((s) => s.id === `s${n}`);
      // The redo call saw the slide's final heading, and its note is the redo's, not the first.
      const heading = String(out.plan.slides[n - 1]?.heading ?? "");
      expect(r.user).toContain(`Slide ${n}: ${heading}`);
      expect(slide?.notes).toContain(`REDONE ${n}`);
    }
    // Slides that did not change keep the deck-wide call's notes; nothing stray lands.
    const redone = new Set(redos.map((r) => `s${r.user.match(/slides only: (\d+)\.$/)?.[1]}`));
    for (const s of out.slides) {
      if (!redone.has(s.id)) expect(s.notes).not.toContain("REDONE");
      expect(s.notes).not.toContain("STRAY");
    }
  });

  test("a redo that fails keeps the deck-wide note, never an empty one", async () => {
    // Every one-slide redo answers with no rows (and its retries too): lessonNotes returns blanks.
    // The deck-wide call writes "DECK n" for every slide (this saved run has no recorded notes).
    const deckRows = () => ({
      slides: Array.from({ length: 20 }, (_, k) => ({
        n: k + 1,
        answers: null,
        misconceptions: null,
        background: `DECK ${k + 1}`,
        run: null,
      })),
    });
    const t = timedServices(() => ({ slides: [] }), deckRows);
    const events: Record<string, unknown>[] = [];
    const services = {
      ...t.services,
      log: (e: object) => events.push(e as Record<string, unknown>),
    };
    const out = await replayRun(FIXTURE, { services });
    const redone = t.calls
      .filter((c) => c.name === "notes" && /slides only/.test(c.user))
      .map((c) => Number(c.user.match(/slides only: (\d+)\.$/)?.[1]));
    expect(redone.length).toBeGreaterThan(0);
    for (const n of new Set(redone)) {
      const kept = out.slides.find((s) => s.id === `s${n}`)?.notes ?? "";
      expect(kept).toContain(`DECK ${n}`);
      expect(events.some((e) => e.ev === "notes-redo-miss" && e.slide === n)).toBe(true);
    }
  });
});
