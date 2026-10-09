import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import incomplete from "./fixtures/incomplete/headings-only-y11.json" with { type: "json" };
import { recordedHeld, recordedVisuals, replayRun, replayServices } from "./replay-fixture";
import { runWriter, WriterIncompleteError } from "./stage";

/*
 * C1 (TEACH-110 part h): the writer's stream is parsed as it arrives and each slide opens as it
 * closes. The 12 saved writer outputs, streamed piece by piece, must give exactly the deck the
 * whole text gives (the replay parity output), with each slide's asks handed over before the
 * stream ends, in slide order. Element ids are random per layout, so they are not compared.
 */

const DIR = join(import.meta.dir, "fixtures/replay");
const LESSONS = readdirSync(DIR).sort();

const pieces = (seed: number) => (text: string) => {
  const out: string[] = [];
  let x = seed;
  for (let at = 0; at < text.length; ) {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    const n = 1 + (x % 64);
    out.push(text.slice(at, at + n));
    at += n;
  }
  return out;
};
/** The deck with every element id dropped (slide ids are kept: they are `s<n>`). */
const stable = (v: unknown, top = true): unknown => {
  if (Array.isArray(v)) return v.map((x) => stable(x, false));
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => !(k === "id" && !top))
        .map(([k, x]) => [k, stable(x, false)]),
    );
  return v;
};

describe.each(LESSONS)("streamed replay %s", (b) => {
  test("the streamed deck equals the whole-text deck; asks and slides come before the end", async () => {
    const whole = await replayRun(b);
    const writerSlides = (
      JSON.parse(
        (JSON.parse(readFileSync(join(DIR, b, "main.json"), "utf8")) as { text: string }).text,
      ) as { slides: unknown[] }
    ).slides.length;
    const asked: number[] = [];
    const shown: number[] = [];
    let editableAt = -1;
    const events: string[] = [];
    const streamed = await replayRun(b, {
      stream: pieces(b.length * 7 + 1),
      onStreamEnd: () => events.push("stream-end"),
      hooks: {
        onAsks: (i) => {
          asked.push(i);
          events.push(`asks:${i}`);
        },
        onSlide: (i) => {
          shown.push(i);
          events.push(`slide:${i}`);
        },
        onEditable: () => {
          editableAt = events.length;
        },
      },
    });
    expect(JSON.stringify(stable(streamed.slides.map((s) => s)))).toBe(
      JSON.stringify(stable(whole.slides.map((s) => s))),
    );
    expect(streamed.checks).toEqual(whole.checks);
    // every slide's asks once, in order: the title, then slides 3, 4, …
    expect(asked).toEqual([0, ...Array.from({ length: writerSlides }, (_, k) => k + 2)]);
    // every slide opens before the writer call returns
    const last = events.indexOf("stream-end");
    expect(last).toBeGreaterThan(0);
    expect(events.slice(0, last).filter((e) => e.startsWith("asks:"))).toHaveLength(asked.length);
    expect(shown.length).toBeGreaterThanOrEqual(asked.length);
    expect(editableAt).toBeGreaterThan(last);
  });
});

describe("a K3-incomplete stream", () => {
  const y11 = join(DIR, "y11-chemistry-rates-of-reaction");
  const brief = JSON.parse(readFileSync(join(y11, "brief.json"), "utf8"));
  const objectives = (
    JSON.parse(readFileSync(join(y11, "objectives.json"), "utf8")) as {
      objectives: { teacher: string }[];
    }
  ).objectives.map((o) => o.teacher);
  const streamOf = async (text: string, finishReason: string) => {
    let shown = 0;
    let editable = false;
    const run = runWriter({
      brief,
      objectives,
      pupilWording: false,
      services: {
        log: () => {},
        chat: () => Promise.reject(new Error("no call expected")),
        writer: async (_r, onDelta) => {
          for (const p of pieces(3)(text)) onDelta(p);
          return { text, finishReason, usd: 0, ms: 0 };
        },
      },
      onSlide: () => {
        shown += 1;
      },
      onEditable: () => {
        editable = true;
      },
    });
    const error = await run.then(
      () => undefined,
      (e: unknown) => e,
    );
    return { error, shown, editable };
  };

  test("the saved headings-only runaway shows nothing and throws", async () => {
    const fx = incomplete as { text: string; finishReason?: string | null };
    const r = await streamOf(fx.text, fx.finishReason ?? "stop");
    expect(r.error).toBeInstanceOf(WriterIncompleteError);
    expect(r).toMatchObject({ shown: 0, editable: false });
  });

  test("a stream cut at its length limit throws after showing its first slides read-only", async () => {
    const main = JSON.parse(readFileSync(join(y11, "main.json"), "utf8")) as { text: string };
    const r = await streamOf(main.text.slice(0, Math.round(main.text.length * 0.6)), "length");
    expect(r.error).toBeInstanceOf(WriterIncompleteError);
    expect(r.shown).toBeGreaterThan(2);
    expect(r.editable).toBe(false);
  });
});

describe("a slide the final parse opens from other words (stream-reopened)", () => {
  const read = (b: string, f: string) => readFileSync(join(DIR, b, f), "utf8");
  /** The saved text with one slide's words changed: what the stream showed before a fix-up. */
  const changed = (text: string, slide: number, edit: (s: Record<string, unknown>) => void) => {
    const out = JSON.parse(text) as { slides: Record<string, unknown>[] };
    edit(out.slides[slide - 2] as Record<string, unknown>);
    return JSON.stringify(out);
  };

  test("its asks start afresh and the deck equals the whole-text replay", async () => {
    const b = "y1-science-animals-young";
    const whole = await replayRun(b);
    const reopened: number[] = [];
    const asked: number[] = [];
    const out = await replayRun(b, {
      stream: (text) =>
        pieces(5)(
          changed(text, 3, (s) => {
            s.heading = "A stale heading";
          }),
        ),
      hooks: {
        onAsks: (i) => asked.push(i),
        onReopen: (i) => reopened.push(i),
      },
    });
    expect(reopened).toEqual([3]);
    expect(asked.filter((i) => i === 3)).toHaveLength(2);
    // the reopen comes before the slide's second asks
    expect(JSON.stringify(stable(out.slides))).toBe(JSON.stringify(stable(whole.slides)));
  });

  test("its old diagram job is cancelled: nothing it draws is kept or logged", async () => {
    const b = "y11-chemistry-rates-of-reaction";
    const brief = JSON.parse(read(b, "brief.json"));
    const objectives = (
      JSON.parse(read(b, "objectives.json")) as { objectives: { teacher: string }[] }
    ).objectives.map((o) => o.teacher);
    const main = JSON.parse(read(b, "main.json")) as { text: string };
    const stale = changed(main.text, 2, (s) => {
      (s.figure as { shows: string }).shows = "STALE magnesium ribbon in acid";
    });
    const done: { slide: number; key: string }[] = [];
    let staleCalls = 0;
    const replay = replayServices(b);
    await runWriter({
      brief,
      objectives,
      pupilWording: false,
      visual: recordedVisuals(b),
      held: recordedHeld(b),
      services: {
        ...replay,
        log: (e) => {
          const ev = e as { ev?: string; slide?: number; key?: string };
          if (ev.ev === "diagram-done") done.push({ slide: ev.slide ?? 0, key: ev.key ?? "" });
        },
        writer: async (_r, onDelta) => {
          for (const p of pieces(9)(stale)) {
            await Promise.resolve();
            onDelta(p);
          }
          return { text: main.text, finishReason: "stop", usd: 0, ms: 0 };
        },
      },
      drawDiagrams: {
        callDrawer: async (req) => {
          if (JSON.stringify(req).includes("STALE")) {
            staleCalls += 1;
            await new Promise((r) => setTimeout(r, 60));
          }
          return { out: {}, usd: 0, ms: 0 } as never;
        },
      },
    }).then(
      () => undefined,
      () => undefined,
    );
    await new Promise((r) => setTimeout(r, 80));
    expect(staleCalls).toBeGreaterThan(0);
    const slide3 = done.filter((d) => d.slide === 3);
    expect(slide3.length).toBe(new Set(slide3.map((d) => d.key)).size);
  });
});
